using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement(HermesDbContext db, ITenantContext context)
{
    private Guid TenantId => context.TenantId ?? throw new InvalidOperationException("Company context is required.");
    private string Actor => context.UserSubject!;
    private static ManagementException Error(int status, string code, string message) => UserAccounts.Error(status, code, message);
    private Task<T> Scoped<T>(string permission, Func<ResourceAccess, Task<T>> action, CancellationToken ct) => TenantTransaction.RunAsync(db, TenantId, async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, TenantId, ct);
        var member = await AccessRules.Authorize(db, TenantId, Actor, permission, ct);
        return await action(new ResourceAccess(member));
    }, ct);
    private void Audit(string action, Guid entityId, object? before, object? after, Guid? vehicleId = null)
    {
        var details = new { entityId, vehicleId, before, after };
        db.AccessAuditEvents.Add(new() { TenantId = TenantId, ActorSubject = Actor, Action = action, Details = JsonSerializer.Serialize(details) });
        UserAccounts.Audit(db, Actor, null, action, details, TenantId);
    }
    private async Task<Vehicle> Car(Guid id, ResourceAccess access, string permission, CancellationToken ct, bool write = false)
    {
        var car = await VehicleAccess.Query(db, access, permission).SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw Error(404, "vehicle_not_found", "A jármű nem található ennél a cégnél.");
        if (write && car.Status == Domain.VehicleStatus.Archived) throw Error(409, "vehicle_archived", "Előbb állítsd vissza az archivált járművet.");
        return car;
    }
    private async Task<VehicleProfile> Profile(Guid vehicleId, CancellationToken ct)
        => await db.VehicleProfiles.SingleOrDefaultAsync(x => x.VehicleId == vehicleId, ct) ?? new() { TenantId = TenantId, VehicleId = vehicleId };
    private void Touch(VehicleProfile profile)
    {
        if (db.Entry(profile).State == EntityState.Detached) db.VehicleProfiles.Add(profile);
        profile.UpdatedAt = DateTimeOffset.UtcNow; profile.UpdatedBy = Actor;
    }
    internal static VehicleSpecification Specification(VehicleProfile p) => new()
    {
        RegistrationCountry = p.RegistrationCountry, Vin = p.Vin, FleetNumber = p.FleetNumber, Category = p.Category, BodyType = p.BodyType, Year = p.Year,
        FirstRegistration = p.FirstRegistration, Color = p.Color, FuelType = p.FuelType, PowerKw = p.PowerKw, EngineCapacityCc = p.EngineCapacityCc,
        Transmission = p.Transmission, Seats = p.Seats, GrossWeightKg = p.GrossWeightKg, PayloadKg = p.PayloadKg, CargoVolumeM3 = p.CargoVolumeM3,
        BatteryKwh = p.BatteryKwh, Ownership = p.Ownership, FleetEntryDate = p.FleetEntryDate, FleetExitDate = p.FleetExitDate,
        InspectionDueDate = p.InspectionDueDate, InsuranceDueDate = p.InsuranceDueDate, NextServiceDate = p.NextServiceDate,
        NextServiceKm = p.NextServiceKm, PreferredServicePartnerId = p.PreferredServicePartnerId, Notes = p.Notes
    };
    internal static void Apply(VehicleProfile p, VehicleSpecification x)
    {
        p.RegistrationCountry = x.RegistrationCountry; p.Vin = x.Vin; p.FleetNumber = x.FleetNumber; p.Category = x.Category; p.BodyType = x.BodyType; p.Year = x.Year;
        p.FirstRegistration = x.FirstRegistration; p.Color = x.Color; p.FuelType = x.FuelType; p.PowerKw = x.PowerKw; p.EngineCapacityCc = x.EngineCapacityCc;
        p.Transmission = x.Transmission; p.Seats = x.Seats; p.GrossWeightKg = x.GrossWeightKg; p.PayloadKg = x.PayloadKg; p.CargoVolumeM3 = x.CargoVolumeM3;
        p.BatteryKwh = x.BatteryKwh; p.Ownership = x.Ownership; p.FleetEntryDate = x.FleetEntryDate; p.FleetExitDate = x.FleetExitDate;
        p.InspectionDueDate = x.InspectionDueDate; p.InsuranceDueDate = x.InsuranceDueDate; p.NextServiceDate = x.NextServiceDate;
        p.NextServiceKm = x.NextServiceKm; p.PreferredServicePartnerId = x.PreferredServicePartnerId; p.Notes = x.Notes;
    }
    private async Task<VehicleRecord> Record(Vehicle v, VehicleProfile p, ResourceAccess access, CancellationToken ct)
    {
        var site = await (from a in db.VehicleSiteAssignments join s in db.Sites on a.SiteId equals s.Id
            where a.VehicleId == v.Id select new { s.Id, s.Name }).SingleOrDefaultAsync(ct);
        var summary = new VehicleSummary(v.Id, v.Registration, v.Make, v.Model, v.Status.ToString())
        { BodyType = p.BodyType, Color = p.Color, Version = v.Version, OdometerKm = v.OdometerKm, SiteId = site?.Id, SiteName = site?.Name, Permissions = VehicleAccess.PermissionsFor(access, site?.Id) };
        var name = p.PreferredServicePartnerId is { } id ? await db.Partners.Where(x => x.Id == id).Select(x => x.Name).SingleOrDefaultAsync(ct) : null;
        return new(summary, Specification(p), name, p.StatusReason, p.UpdatedAt, p.UpdatedBy);
    }
    public Task<VehicleRecord> GetVehicle(Guid id, CancellationToken ct) => Scoped(Permissions.VehiclesRead, async access =>
        await Record(await Car(id, access, Permissions.VehiclesRead, ct), await Profile(id, ct), access, ct), ct);
    public Task<VehicleMoveOptions> SiteOptions(Guid id, CancellationToken ct) => Scoped(Permissions.SitesAssignVehicles, async access =>
    {
        await AccessRules.Authorize(db, TenantId, Actor, Permissions.VehiclesRead, ct);
        await Car(id, access, Permissions.VehiclesRead, ct); await Car(id, access, Permissions.SitesAssignVehicles, ct);
        var read = access.Sites(Permissions.VehiclesRead); var assign = access.Sites(Permissions.SitesAssignVehicles);
        var allRead = access.CompanyWide(Permissions.VehiclesRead); var allAssign = access.CompanyWide(Permissions.SitesAssignVehicles);
        return new VehicleMoveOptions(allRead && allAssign, await db.Sites.AsNoTracking().Where(s => !s.IsArchived && (allRead || read.Contains(s.Id)) && (allAssign || assign.Contains(s.Id)))
            .OrderBy(s => s.Name).Select(s => new VehicleSiteOption(s.Id, s.Name, s.Code)).ToArrayAsync(ct));
    }, ct);

    public Task<VehicleRecord> SaveVehicle(Guid id, SaveVehicleRecord input, CancellationToken ct) => Scoped(Permissions.VehiclesUpdate, async access =>
    {
        var v = await Car(id, access, Permissions.VehiclesUpdate, ct, write: true);
        FleetValidation.Revision(v.Version, input.Version);
        var baseErrors = VehicleValidation.Validate(new(input.Registration, input.Make, input.Model));
        if (baseErrors.Count != 0) throw FleetValidation.Invalid(string.Join(" ", baseErrors.Select(x => $"{x.Key}: {string.Join(' ', x.Value)}")));
        var data = FleetValidation.Specification(input.Data);
        FleetValidation.Choice(input.Status, "Jármű állapota", "Active", "Maintenance", "Inactive");
        var p = await Profile(id, ct); var before = await Record(v, p, access, ct);
        if (data.Ownership is not ("Leased" or "Rented") && await db.VehicleLeases.AnyAsync(x => x.VehicleId == id && x.Status == "Active", ct))
            throw Error(409, "active_lease", "Aktív szerződés mellett a jármű tulajdonlása nem állítható sajátra. Előbb zárd le a szerződést.");
        if (data.PreferredServicePartnerId is { } partnerId)
            await EligiblePartner(partnerId, false, data.PreferredServicePartnerId == p.PreferredServicePartnerId, ct);
        var registration = NormalizeRegistration(input.Registration);
        if (registration != v.Registration || data.RegistrationCountry != p.RegistrationCountry)
            db.VehicleRegistrations.Add(new() { TenantId = TenantId, VehicleId = id, Registration = registration, CountryCode = data.RegistrationCountry, RecordedBy = Actor });
        v.Registration = registration; v.Make = input.Make.Trim(); v.Model = input.Model.Trim(); v.Status = Enum.Parse<VehicleStatus>(input.Status);
        Apply(p, data); Touch(p); v.Version++;
        await LearnModel(db, TenantId, v.Make, v.Model, ct);
        var after = await Record(v, p, access, ct);
        Audit("vehicle.details_updated", id, before, after, id);
        await db.SaveChangesAsync(ct);
        return after;
    }, ct);
    internal static string NormalizeRegistration(string value) => string.Concat(value.Where(c => !char.IsWhiteSpace(c))).ToUpperInvariant();

    public Task<VehicleRecord> VehicleStatus(Guid id, VehicleStateInput input, CancellationToken ct) => Scoped(Permissions.VehiclesArchive, async access =>
    {
        var v = await Car(id, access, Permissions.VehiclesArchive, ct); FleetValidation.Revision(v.Version, input.Version);
        if (input.IsArchived is null) throw FleetValidation.Invalid("Add meg az archivált állapotot.");
        var reason = OrganizationValidation.Reason(input.Reason); var p = await Profile(id, ct); var before = await Record(v, p, access, ct);
        if ((v.Status == Domain.VehicleStatus.Archived) == input.IsArchived) return before;
        v.Status = input.IsArchived.Value ? Domain.VehicleStatus.Archived : Domain.VehicleStatus.Inactive;
        p.StatusReason = reason; Touch(p); v.Version++;
        var after = await Record(v, p, access, ct); Audit("vehicle.status_changed", id, before, after, id); await db.SaveChangesAsync(ct);
        return after;
    }, ct);
    public Task<PageResult<RegistrationEntry>> Registrations(Guid id, int page, CancellationToken ct) => Scoped(Permissions.VehiclesRead, async access =>
    {
        await Car(id, access, Permissions.VehiclesRead, ct); FleetValidation.Page(page);
        var q = db.VehicleRegistrations.AsNoTracking().Where(x => x.VehicleId == id);
        return new PageResult<RegistrationEntry>(await q.OrderByDescending(x => x.RecordedAt).ThenByDescending(x => x.Id).Skip((page - 1) * 25).Take(25)
            .Select(x => new RegistrationEntry(x.Id, x.Registration, x.CountryCode, x.RecordedBy, x.RecordedAt)).ToArrayAsync(ct), await q.CountAsync(ct), page, 25);
    }, ct);
    public Task<PageResult<OdometerEntry>> Odometer(Guid id, int page, CancellationToken ct) => Scoped(Permissions.VehiclesRead, async access =>
    {
        await Car(id, access, Permissions.VehiclesRead, ct); FleetValidation.Page(page);
        var q = db.OdometerReadings.AsNoTracking().Where(x => x.VehicleId == id);
        return new PageResult<OdometerEntry>(await q.OrderByDescending(x => x.RecordedAt).ThenByDescending(x => x.Id).Skip((page - 1) * 25).Take(25)
            .Select(x => new OdometerEntry(x.Id, x.Kilometers, x.RecordedBy, x.RecordedAt)).ToArrayAsync(ct), await q.CountAsync(ct), page, 25);
    }, ct);
    public Task<PageResult<AuditSummary>> History(Guid id, bool vehicle, int page, CancellationToken ct) => Scoped(Permissions.AuditRead, async access =>
    {
        FleetValidation.Page(page);
        if (vehicle) await Car(id, access, Permissions.AuditRead, ct);
        else { await AccessRules.Authorize(db, TenantId, Actor, Permissions.PartnersRead, ct); await Partner(id, ct); }
        var key = id.ToString();
        var query = db.AccessAuditEvents.FromSqlInterpolated($"""
            SELECT * FROM access_audit_events e WHERE
              CASE WHEN {vehicle} THEN
                (e."Action" LIKE 'vehicle.%' OR e."Action" = 'site.vehicle_assigned') AND
                coalesce(e."Details"->>'vehicleId', e."Details"->>'entityId', e."Details"->>'Id') = {key}
              ELSE e."Action" LIKE 'partner.%' AND e."Details"->>'entityId' = {key} END
            """).AsNoTracking();
        var rows = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * 25).Take(25)
            .Select(x => new AuditSummary(x.Id, x.ActorSubject, x.Action, x.TargetSubject, x.Details, x.CreatedAt)).ToArrayAsync(ct);
        var names = await IdentityHistory.Resolve(db, rows.Select(x => x.ActorSubject), ct);
        return new PageResult<AuditSummary>(rows.Select(x => x with { ActorSubject = IdentityHistory.Subject(names, x.ActorSubject), OriginalActorSubject = x.ActorSubject }).ToArray(),
            await query.CountAsync(ct), page, 25);
    }, ct);
}
