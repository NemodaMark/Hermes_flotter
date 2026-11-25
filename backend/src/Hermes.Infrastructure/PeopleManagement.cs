using System.Security.Cryptography;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class PeopleManagement(HermesDbContext db, TenantContext context, UserAccounts accounts)
{
    private async Task<T> Read<T>(string actor, string target, Guid? company, Func<ApplicationUser, bool, Task<T>> action, CancellationToken ct)
    {
        async Task<T> Run()
        {
            await UserAccounts.LockSystemAccess(db, ct, shared: true);
            var manager = await UserAccounts.IsSystemManager(db, actor, ct);
            if (company is { } id)
            {
                await AccessRules.LockTenant(db, id, ct);
                if (!manager)
                {
                    var memberships = await db.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == id && x.IsActive && (x.UserSubject == actor || x.UserSubject == target)).ToArrayAsync(ct);
                    if (!memberships.Any(x => x.UserSubject == actor && x.HasCompanyAccess)
                        || actor != target && !memberships.Any(x => x.UserSubject == target && x.HasCompanyAccess))
                        throw UserAccounts.Error(404, "person_not_found", "A profil ennél a cégnél nem érhető el.");
                }
            }
            else if (actor != target && !manager) throw UserAccounts.Error(404, "person_not_found", "A profil nem érhető el.");
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == target && !db.AccountLifecycles.Any(a => a.UserId == x.Id && a.IsArchived), ct)
                ?? throw UserAccounts.Error(404, "person_not_found", "A profil nem található.");
            return await action(user, manager);
        }
        if (company is { } tenant)
        {
            context.Set(tenant, actor, []);
            return await TenantTransaction.RunAsync(db, tenant, Run, ct);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var result = await Run(); await tx.CommitAsync(ct); return result;
    }

    private IQueryable<PersonSummary> Summaries(IQueryable<ApplicationUser> users)
        => users.Select(u => new PersonSummary(u.Id, u.DisplayName, u.Email!, u.PhoneNumber,
            db.UserAvatars.Where(x => x.UserId == u.Id).Select(x => x.Sha256).FirstOrDefault())
        {
            CardBackgroundRevision = db.UserCardBackgrounds.Where(x => x.UserId == u.Id).Select(x => x.Sha256).FirstOrDefault()
        });

    private Task<PersonSummary> Summary(ApplicationUser user, CancellationToken ct)
        => Summaries(db.Users.AsNoTracking().Where(x => x.Id == user.Id)).SingleAsync(ct);

    public Task<PageResult<PersonSummary>> Colleagues(string actor, Guid company, int page, string? search, CancellationToken ct)
        => Read(actor, actor, company, async (_, _) =>
        {
            FleetValidation.Page(page);
            if (search?.Length > 100) throw FleetValidation.Invalid("A keresés legfeljebb 100 karakter lehet.");
            var members = await db.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == company && x.IsActive).ToArrayAsync(ct);
            var ids = members.Where(x => x.HasCompanyAccess).Select(x => x.UserSubject).ToArray();
            var q = db.Users.AsNoTracking().Where(x => ids.Contains(x.Id) && !db.AccountLifecycles.Any(a => a.UserId == x.Id && a.IsArchived));
            if (!string.IsNullOrWhiteSpace(search))
            {
                var text = search.Trim().ToUpperInvariant();
                q = q.Where(x => x.NormalizedUserName!.Contains(text) || x.NormalizedEmail!.Contains(text) || EF.Functions.Collate(x.DisplayName, "unicode").ToUpper().Contains(text));
            }
            var total = await q.CountAsync(ct);
            var rows = await Summaries(q.OrderBy(x => x.Id).Skip((page - 1) * 25).Take(25)).ToArrayAsync(ct);
            return new PageResult<PersonSummary>(rows, total, page, 25);
        }, ct);

    public Task<PersonProfile> Profile(string actor, string target, Guid? company, CancellationToken ct)
        => Read(actor, target, company, async (user, manager) =>
        {
            PersonVehicle[] cars = [];
            if (company is { } tenant)
            {
                var member = manager ? TenantDirectory.SystemMembership(actor, tenant)
                    : await db.Memberships.AsNoTracking().WithAccess().SingleAsync(x => x.TenantId == tenant && x.UserSubject == actor && x.IsActive, ct);
                var access = new ResourceAccess(member);
                if (member.EffectivePermissions.Contains(Permissions.VehiclesRead))
                    cars = await (from a in db.VehicleUserAssignments
                        join v in VehicleAccess.Query(db, access, Permissions.VehiclesRead) on a.VehicleId equals v.Id
                        join s in db.VehicleSiteAssignments on v.Id equals s.VehicleId into sites from s in sites.DefaultIfEmpty()
                        join location in db.Sites on s.SiteId equals location.Id into locations from location in locations.DefaultIfEmpty()
                        where a.UserId == target && a.ReleasedAt == null && v.Status != VehicleStatus.Archived
                        orderby v.Registration select new PersonVehicle(v.Id, v.Registration, v.Make, v.Model, location.Name)).ToArrayAsync(ct);
            }
            return new PersonProfile(await Summary(user, ct), user.ProfileVersion, manager || actor == target, manager, cars);
        }, ct);

    public Task<byte[]> Avatar(string actor, string target, Guid? company, CancellationToken ct)
        => Read(actor, target, company, async (_, _) => await db.UserAvatars.Where(x => x.UserId == target).Select(x => x.Bytes).SingleOrDefaultAsync(ct)
            ?? throw UserAccounts.Error(404, "avatar_not_found", "Nincs feltöltött profilkép."), ct);

    public Task<byte[]> CardBackground(string actor, string target, Guid? company, CancellationToken ct)
        => Read(actor, target, company, async (_, _) => await db.UserCardBackgrounds.Where(x => x.UserId == target).Select(x => x.Bytes).SingleOrDefaultAsync(ct)
            ?? throw UserAccounts.Error(404, "card_background_not_found", "Nincs feltöltött kártyaháttér."), ct);

    private async Task<T> Write<T>(string actor, string target, long version, Func<ApplicationUser, Task<T>> action, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await UserAccounts.LockSystemAccess(db, ct);
        if (actor != target && !await UserAccounts.IsSystemManager(db, actor, ct)) throw UserAccounts.Error(403, "profile_write_denied", "Csak a saját profilodat szerkesztheted.");
        var user = await accounts.LockUser(target, ct); UserAccounts.CheckVersion(user, version);
        var result = await action(user); await tx.CommitAsync(ct); return result;
    }
    public Task<PersonSummary> EditSelf(string actor, EditOwnProfile input, CancellationToken ct) => Write(actor, actor, input.Version, async user =>
    {
        UserAccounts.ValidateName(input.DisplayName);
        var phone = OrganizationValidation.Text(input.PhoneNumber, 40, "Telefonszám");
        var before = new { user.DisplayName, user.PhoneNumber };
        user.DisplayName = input.DisplayName.Trim(); user.PhoneNumber = phone; user.ProfileVersion++;
        UserAccounts.Audit(db, actor, actor, "user.profile_changed", new { before, after = new { user.DisplayName, user.PhoneNumber } });
        await db.SaveChangesAsync(ct); return await Summary(user, ct);
    }, ct);

    public async Task<PersonSummary> UploadAvatar(string actor, string target, Func<Task<ImageUpload>> read, CancellationToken ct)
    {
        if (actor != target && !await UserAccounts.IsSystemManager(db, actor, ct)) throw UserAccounts.Error(403, "profile_write_denied", "A profilkép nem módosítható.");
        var upload = await read(); var bytes = ImageProcessing.Normalize(upload, avatar: true);
        return await Write(actor, target, upload.Version, async user =>
        {
            var avatar = await db.UserAvatars.SingleOrDefaultAsync(x => x.UserId == target, ct);
            var before = avatar?.Sha256;
            if (avatar is null) { avatar = new() { UserId = target, Bytes = bytes, Sha256 = "" }; db.UserAvatars.Add(avatar); }
            avatar.Bytes = bytes; avatar.Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)); avatar.UpdatedAt = DateTimeOffset.UtcNow;
            user.ProfileVersion++;
            UserAccounts.Audit(db, actor, target, "user.avatar_changed", new { before, after = avatar.Sha256 });
            await db.SaveChangesAsync(ct); return await Summary(user, ct);
        }, ct);
    }
    public Task<PersonSummary> DeleteAvatar(string actor, string target, long version, CancellationToken ct) => Write(actor, target, version, async user =>
    {
        var avatar = await db.UserAvatars.SingleOrDefaultAsync(x => x.UserId == target, ct);
        if (avatar is not null)
        {
            db.UserAvatars.Remove(avatar); user.ProfileVersion++;
            UserAccounts.Audit(db, actor, target, "user.avatar_deleted", new { before = avatar.Sha256 }); await db.SaveChangesAsync(ct);
        }
        return await Summary(user, ct);
    }, ct);

    public async Task<PersonSummary> UploadCardBackground(string actor, Func<Task<ImageUpload>> read, CancellationToken ct)
    {
        var upload = await read();
        var bytes = ImageProcessing.NormalizeCardBackground(upload);
        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        return await Write(actor, actor, upload.Version, async user =>
        {
            var background = await db.UserCardBackgrounds.SingleOrDefaultAsync(x => x.UserId == actor, ct);
            var before = background?.Sha256;
            if (before == hash) return await Summary(user, ct);
            if (background is null) db.UserCardBackgrounds.Add(new() { UserId = actor, Bytes = bytes, Sha256 = hash });
            else { background.Bytes = bytes; background.Sha256 = hash; }
            user.ProfileVersion++;
            UserAccounts.Audit(db, actor, actor, "user.card_background_changed", new { before, after = hash });
            await db.SaveChangesAsync(ct);
            return await Summary(user, ct);
        }, ct);
    }

    public Task<PersonSummary> DeleteCardBackground(string actor, long version, CancellationToken ct) => Write(actor, actor, version, async user =>
    {
        var background = await db.UserCardBackgrounds.SingleOrDefaultAsync(x => x.UserId == actor, ct);
        if (background is not null)
        {
            db.UserCardBackgrounds.Remove(background);
            user.ProfileVersion++;
            UserAccounts.Audit(db, actor, actor, "user.card_background_deleted", new { before = background.Sha256 });
            await db.SaveChangesAsync(ct);
        }
        return await Summary(user, ct);
    }, ct);
}
