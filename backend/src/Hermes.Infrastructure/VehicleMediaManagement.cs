using System.Security.Cryptography;
using System.Text;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    internal static async Task LearnModel(HermesDbContext db, Guid tenant, string make, string model, CancellationToken ct)
    {
        var makeKey = make.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        var modelKey = model.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        if (!await db.VehicleModelOptions.AnyAsync(x => x.MakeKey == makeKey && x.ModelKey == modelKey, ct))
            db.VehicleModelOptions.Add(new() { TenantId = tenant, MakeKey = makeKey, ModelKey = modelKey, Make = make.Trim(), Model = model.Trim() });
    }
    public Task<ModelOption[]> Catalog(CancellationToken ct)
        => Scoped(context.Permissions.Contains(Permissions.VehiclesCreate) ? Permissions.VehiclesCreate : Permissions.VehiclesUpdate,
            async _ => await db.VehicleModelOptions.AsNoTracking().OrderBy(x => x.Make).ThenBy(x => x.Model).Select(x => new ModelOption(x.Make, x.Model)).ToArrayAsync(ct), ct);

    private async Task<PhotoCollection> Photos(Vehicle car, CancellationToken ct) => new(await db.VehiclePhotos.Where(x => x.VehicleId == car.Id).OrderBy(x => x.Slot)
        .Select(x => new PhotoSummary(x.Id, x.Slot, x.Sha256, x.UploadedAt)).ToArrayAsync(ct), car.Version);
    public Task<PhotoCollection> Photos(Guid id, CancellationToken ct) => Scoped(Permissions.VehiclesRead, async access => await Photos(await Car(id, access, Permissions.VehiclesRead, ct), ct), ct);
    public Task<byte[]> Photo(Guid id, Guid photo, CancellationToken ct) => Scoped(Permissions.VehiclesRead, async access =>
    {
        await Car(id, access, Permissions.VehiclesRead, ct);
        return await db.VehiclePhotos.Where(x => x.VehicleId == id && x.Id == photo).Select(x => x.Bytes).SingleOrDefaultAsync(ct)
            ?? throw Error(404, "photo_not_found", "A fénykép nem található.");
    }, ct);

    private Task<T> PhotoWrite<T>(Guid id, Func<Vehicle, Task<T>> action, CancellationToken ct) => TenantTransaction.RunAsync(db, TenantId, async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, TenantId, ct);
        var member = await UserAccounts.IsSystemManager(db, Actor, ct) ? TenantDirectory.SystemMembership(Actor, TenantId)
            : await db.Memberships.AsNoTracking().WithAccess().SingleOrDefaultAsync(x => x.TenantId == TenantId && x.UserSubject == Actor && x.IsActive, ct);
        if (member?.HasCompanyAccess != true) throw Error(403, "permission_denied", "Nincs céges hozzáférésed.");
        var car = await db.Vehicles.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw Error(404, "vehicle_not_found", "A jármű nem található.");
        await db.Entry(car).ReloadAsync(ct);
        var site = await db.VehicleSiteAssignments.Where(x => x.VehicleId == id).Select(x => (Guid?)x.SiteId).SingleOrDefaultAsync(ct);
        var access = new ResourceAccess(member);
        var initial = car.CreatedBy == Actor && car.CreatedAt >= DateTime.UtcNow.AddMinutes(-15) && access.Allows(Permissions.VehiclesCreate, site);
        if (!access.Allows(Permissions.VehiclesUpdate, site) && !initial) throw Error(404, "vehicle_not_found", "A jármű nem található, vagy nem szerkeszthető.");
        if (car.Status == Domain.VehicleStatus.Archived) throw Error(409, "vehicle_archived", "Előbb állítsd vissza az archivált járművet.");
        return await action(car);
    }, ct);

    public async Task<PhotoCollection> UploadPhoto(Guid id, Func<Task<ImageUpload>> read, CancellationToken ct)
    {
        await PhotoWrite(id, _ => Task.FromResult(true), ct); // Authorize before reading a body.
        var upload = await read();
        var bytes = ImageProcessing.Normalize(upload, avatar: false);
        return await PhotoWrite(id, async car =>
        {
            FleetValidation.Revision(car.Version, upload.Version);
            var slots = await db.VehiclePhotos.Where(x => x.VehicleId == id).Select(x => x.Slot).ToArrayAsync(ct);
            var slot = Enumerable.Range(1, 5).Except(slots).FirstOrDefault();
            if (slot == 0) throw Error(409, "photo_limit", "Járművenként legfeljebb öt fénykép tölthető fel.");
            var item = new VehiclePhoto { TenantId = TenantId, VehicleId = id, Slot = slot, Bytes = bytes, Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)), UploadedBy = Actor };
            db.VehiclePhotos.Add(item); car.Version++;
            Audit("vehicle.photo_uploaded", item.Id, null, new { vehicleId = id, item.Slot, item.Sha256 }, id);
            await db.SaveChangesAsync(ct);
            return await Photos(car, ct);
        }, ct);
    }
    public Task<PhotoCollection> DeletePhoto(Guid id, Guid photo, long version, CancellationToken ct) => PhotoWrite(id, async car =>
    {
        FleetValidation.Revision(car.Version, version);
        var item = await db.VehiclePhotos.SingleOrDefaultAsync(x => x.VehicleId == id && x.Id == photo, ct) ?? throw Error(404, "photo_not_found", "A fénykép nem található.");
        db.VehiclePhotos.Remove(item); car.Version++;
        Audit("vehicle.photo_deleted", photo, new { vehicleId = id, item.Slot, item.Sha256 }, null, id);
        await db.SaveChangesAsync(ct);
        return await Photos(car, ct);
    }, ct);

    public Task<VehicleAssignee?> Assignee(Guid id, CancellationToken ct) => Scoped<VehicleAssignee?>(Permissions.VehiclesRead, async access =>
    {
        await Car(id, access, Permissions.VehiclesRead, ct);
        return await (from a in db.VehicleUserAssignments join u in db.Users on a.UserId equals u.Id where a.VehicleId == id && a.ReleasedAt == null
            select new VehicleAssignee(u.Id, u.DisplayName, a.AssignedAt)).SingleOrDefaultAsync(ct);
    }, ct);
    public Task<PersonSummary[]> AssigneeOptions(Guid id, CancellationToken ct) => Scoped(Permissions.VehiclesAssignUsers, async access =>
    {
        await Car(id, access, Permissions.VehiclesAssignUsers, ct);
        var members = await db.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == TenantId && x.IsActive).ToArrayAsync(ct);
        var ids = members.Where(x => x.HasCompanyAccess).Select(x => x.UserSubject).ToArray();
        return await db.Users.Where(x => ids.Contains(x.Id) && !db.AccountLifecycles.Any(a => a.UserId == x.Id && a.IsArchived))
            .OrderBy(x => x.DisplayName).Select(x => new PersonSummary(x.Id, x.DisplayName, x.Email!, x.PhoneNumber, null)).ToArrayAsync(ct);
    }, ct);
    public Task<PageResult<VehicleAssignmentHistory>> AssigneeHistory(Guid id, int page, CancellationToken ct)
        => Scoped(Permissions.VehiclesRead, async access =>
        {
            await Car(id, access, Permissions.VehiclesRead, ct);
            FleetValidation.Page(page);
            var query = db.VehicleUserAssignments.AsNoTracking().Where(x => x.VehicleId == id);
            var total = await query.CountAsync(ct);
            var rows = await query.OrderByDescending(x => x.AssignedAt).ThenByDescending(x => x.Id)
                .Skip((page - 1) * 25).Take(25).ToArrayAsync(ct);
            // Resolve only names for this vehicle's history, without exposing account or membership details.
            // The stable usernames remain usable if an account has since been removed.
            var subjects = rows.SelectMany(x => new[] { x.UserId, x.AssignedBy, x.ReleasedBy }).OfType<string>().Distinct().ToArray();
            var names = await db.Users.AsNoTracking().Where(x => subjects.Contains(x.Id))
                .Select(x => new { x.Id, x.DisplayName }).ToDictionaryAsync(x => x.Id, x => x.DisplayName, ct);
            string Name(string subject) => names.GetValueOrDefault(subject, subject);
            return new PageResult<VehicleAssignmentHistory>(rows.Select(x => new VehicleAssignmentHistory(x.Id, x.UserId, Name(x.UserId),
                x.AssignedAt, x.ReleasedAt, x.AssignedBy, Name(x.AssignedBy), x.ReleasedBy, x.ReleasedBy is null ? null : Name(x.ReleasedBy))).ToArray(), total, page, 25);
        }, ct);
    public Task<VehicleAssignee?> AssignUser(Guid id, AssignUserInput input, CancellationToken ct) => Scoped<VehicleAssignee?>(Permissions.VehiclesAssignUsers, async access =>
    {
        var car = await Car(id, access, Permissions.VehiclesAssignUsers, ct, write: true); FleetValidation.Revision(car.Version, input.Version);
        ApplicationUser? user = null;
        if (input.UserId is { } userId)
        {
            var member = await db.Memberships.AsNoTracking().WithAccess().SingleOrDefaultAsync(x => x.TenantId == TenantId && x.UserSubject == userId && x.IsActive, ct);
            if (member?.HasCompanyAccess != true || await db.AccountLifecycles.AnyAsync(x => x.UserId == userId && x.IsArchived, ct))
                throw Error(400, "invalid_assignee", "Válassz aktív céges felhasználót.");
            user = await db.Users.SingleAsync(x => x.Id == userId, ct);
        }
        var current = await db.VehicleUserAssignments.SingleOrDefaultAsync(x => x.VehicleId == id && x.ReleasedAt == null, ct);
        if (current?.UserId == input.UserId) return current is null ? null : new(current.UserId, user!.DisplayName, current.AssignedAt);
        var changedAt = DateTimeOffset.UtcNow;
        if (current is not null) { current.ReleasedAt = changedAt; current.ReleasedBy = Actor; await db.SaveChangesAsync(ct); }
        var next = user is null ? null : new VehicleUserAssignment { TenantId = TenantId, VehicleId = id, UserId = user.Id, AssignedBy = Actor, AssignedAt = changedAt };
        if (next is not null) db.VehicleUserAssignments.Add(next);
        car.Version++;
        Audit("vehicle.user_assigned", id, current?.UserId, user?.Id, id); await db.SaveChangesAsync(ct);
        return next is null ? null : new(next.UserId, user!.DisplayName, next.AssignedAt);
    }, ct);
}
