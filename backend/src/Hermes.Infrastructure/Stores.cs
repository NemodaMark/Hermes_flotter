using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class TenantDirectory(HermesDbContext db, TenantContext context) : ITenantDirectory
{
    public async Task<TenantSummary> CreateForUserAsync(string subject, CreateTenantRequest request, CancellationToken cancellationToken)
    {
        var tenant = new Tenant { Id = Guid.CreateVersion7(), Name = request.Name.Trim() };
        context.Set(tenant.Id, subject, Permissions.All);
        return await TenantTransaction.RunAsync(db, tenant.Id, async () =>
        {
            await UserAccounts.LockSystemAccess(db, cancellationToken);
            var creator = await db.Users.SingleAsync(x => x.Id == subject, cancellationToken);
            creator.ProfileVersion++; // Creating a company also creates a group assignment.
            db.Tenants.Add(tenant);
            var profile = new CompanyProfile { TenantId = tenant.Id, CreatedAt = DateTimeOffset.UtcNow, CreatedBy = subject };
            db.CompanyProfiles.Add(profile);
            var admin = await db.PermissionGroups.SingleAsync(x => x.IsAdmin, cancellationToken);
            db.GroupCompanies.Add(new GroupCompany { TenantId = tenant.Id, GroupId = admin.Id });
            if (!await db.GroupUsers.AnyAsync(x => x.GroupId == admin.Id && x.UserId == subject, cancellationToken))
                db.GroupUsers.Add(new GroupUser { GroupId = admin.Id, UserId = subject });
            db.GroupUserCompanies.Add(new GroupUserCompany { GroupId = admin.Id, UserId = subject, TenantId = tenant.Id });
            db.Memberships.Add(new TenantMembership
            {
                TenantId = tenant.Id, UserSubject = subject, JoinedAt = DateTimeOffset.UtcNow,
                Groups = [new MembershipGroup { TenantId = tenant.Id, UserSubject = subject, GroupId = admin.Id, Group = admin }]
            });
            var creation = new { before = (object?)null, after = new { tenant.Id, tenant.Name, tenant.TimeZone, profile }, permissions = Permissions.All, adminGroupId = admin.Id };
            db.AccessAuditEvents.Add(new AccessAuditEvent { TenantId = tenant.Id, ActorSubject = subject, Action = "company.created", TargetSubject = subject, Details = System.Text.Json.JsonSerializer.Serialize(creation) });
            UserAccounts.Audit(db, subject, subject, "company.created", creation, tenant.Id);
            await db.SaveChangesAsync(cancellationToken);
            return new TenantSummary(tenant.Id, tenant.Name, Permissions.All)
                { PermissionScopes = new ResourceAccess(SystemMembership(subject, tenant.Id)).Describe() };
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<TenantSummary>> ListForUserAsync(string subject, CancellationToken cancellationToken, bool includeInactive = false)
    {
        var tenants = includeInactive ? db.Tenants.IgnoreQueryFilters() : db.Tenants;
        if (await UserAccounts.IsSystemManager(db, subject, cancellationToken))
        {
            var items = await tenants.AsNoTracking().OrderBy(x => x.Name).Select(x => new TenantSummary(x.Id, x.Name, Permissions.All)).ToArrayAsync(cancellationToken);
            return items.Select(x => x with { PermissionScopes = new ResourceAccess(SystemMembership(subject, x.Id)).Describe() }).ToArray();
        }
        var companies = await (from membership in db.Memberships.AsNoTracking()
                  join tenant in tenants.AsNoTracking() on membership.TenantId equals tenant.Id
                  where membership.UserSubject == subject && membership.IsActive
                  orderby tenant.Name
                  select new { tenant.Id, tenant.Name })
            .ToListAsync(cancellationToken);
        var result = new List<TenantSummary>();
        foreach (var company in companies)
        {
            var member = await TenantTransaction.RunAsync(db, company.Id, async () =>
            {
                return await db.Memberships.AsNoTracking().WithAccess().IgnoreQueryFilters()
                    .SingleAsync(x => x.TenantId == company.Id && x.UserSubject == subject, cancellationToken);
            }, cancellationToken);
            if (member.HasCompanyAccess) result.Add(new(company.Id, company.Name, member.EffectivePermissions)
                { PermissionScopes = new ResourceAccess(member).Describe() });
        }
        return result;
    }

    public async Task<TenantMembership?> FindMembershipAsync(string subject, Guid tenantId, CancellationToken cancellationToken, bool includeInactive = false)
    {
        var tenants = includeInactive ? db.Tenants.IgnoreQueryFilters() : db.Tenants;
        if (!await tenants.AnyAsync(x => x.Id == tenantId, cancellationToken)) return null;
        if (await UserAccounts.IsSystemManager(db, subject, cancellationToken)) return SystemMembership(subject, tenantId);
        var member = await TenantTransaction.RunAsync(db, tenantId, () => db.Memberships.AsNoTracking().WithAccess()
            .IgnoreQueryFilters().SingleOrDefaultAsync(x => x.UserSubject == subject && x.TenantId == tenantId && x.IsActive, cancellationToken), cancellationToken);
        return member?.HasCompanyAccess == true ? member : null;
    }
    internal static TenantMembership SystemMembership(string subject, Guid tenantId)
        => new() { TenantId = tenantId, UserSubject = subject, Permissions = Permissions.All.Select(code => new MembershipPermission
            { TenantId = tenantId, UserSubject = subject, Code = code }).ToList() };
}

public sealed class VehicleStore(HermesDbContext db, ITenantContext tenantContext) : IVehicleStore
{
    private Guid TenantId => tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context is required.");
    private static VehicleSummary Summary(Vehicle x, ResourceAccess access, Guid? siteId, string? siteName) => new(x.Id, x.Registration, x.Make, x.Model, x.Status.ToString())
        { Version = x.Version, OdometerKm = x.OdometerKm, SiteId = siteId, SiteName = siteName, Permissions = VehicleAccess.PermissionsFor(access, siteId) };
    private async Task<VehicleSummary> Summary(Vehicle x, ResourceAccess access, CancellationToken ct)
    {
        var site = await (from a in db.VehicleSiteAssignments join s in db.Sites on a.SiteId equals s.Id
            where a.VehicleId == x.Id select new { s.Id, s.Name }).SingleOrDefaultAsync(ct);
        return Summary(x, access, site?.Id, site?.Name);
    }
    public Task<VehicleSummary?> GetAsync(Guid id, CancellationToken ct) => Authorized<VehicleSummary?>(Permissions.VehiclesRead, async access =>
        await VehicleAccess.Query(db, access, Permissions.VehiclesRead).AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) is { } vehicle
            ? await Summary(vehicle, access, ct) : null, ct);
    public Task<IReadOnlyList<VehicleSummary>> ListAsync(CancellationToken ct) => Authorized<IReadOnlyList<VehicleSummary>>(Permissions.VehiclesRead, async access =>
    {
        var rows = await (from v in VehicleAccess.Query(db, access, Permissions.VehiclesRead).AsNoTracking()
            join a in db.VehicleSiteAssignments on v.Id equals a.VehicleId into assignments from a in assignments.DefaultIfEmpty()
            join s in db.Sites on a.SiteId equals s.Id into sites from s in sites.DefaultIfEmpty()
            orderby v.Registration select new { Vehicle = v, SiteId = (Guid?)a.SiteId, SiteName = s.Name }).ToArrayAsync(ct);
        var ids = rows.Select(x => x.Vehicle.Id).ToArray();
        var registrations = await db.VehicleRegistrations.AsNoTracking().Where(x => ids.Contains(x.VehicleId))
            .Select(x => new { x.VehicleId, x.Registration }).Distinct().ToArrayAsync(ct);
        var previous = registrations.ToLookup(x => x.VehicleId, x => x.Registration);
        return rows.Select(x => Summary(x.Vehicle, access, x.SiteId, x.SiteName) with
            { PreviousRegistrations = previous[x.Vehicle.Id].Where(p => p != x.Vehicle.Registration).ToArray() }).ToArray();
    }, ct);
    private Task<T> Authorized<T>(string permission, Func<ResourceAccess, Task<T>> action, CancellationToken ct) => TenantTransaction.RunAsync(db, TenantId, async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, TenantId, ct);
        var member = await AccessRules.Authorize(db, TenantId, tenantContext.UserSubject!, permission, ct);
        return await action(new ResourceAccess(member));
    }, ct);
    public Task<VehicleCreationOptions> CreationOptionsAsync(CancellationToken ct) => Authorized(Permissions.VehiclesCreate, async access =>
    {
        var ids = access.Sites(Permissions.VehiclesCreate); var all = access.CompanyWide(Permissions.VehiclesCreate);
        return new VehicleCreationOptions(all, await db.Sites.AsNoTracking().Where(s => !s.IsArchived && (all || ids.Contains(s.Id))).OrderBy(s => s.Name)
            .Select(s => new VehicleSiteOption(s.Id, s.Name, s.Code)).ToArrayAsync(ct));
    }, ct);
    private void Audit(string action, object details)
    {
        UserAccounts.Audit(db, tenantContext.UserSubject!, null, action, details, TenantId);
        db.AccessAuditEvents.Add(new() { TenantId = TenantId, ActorSubject = tenantContext.UserSubject!, Action = action, Details = System.Text.Json.JsonSerializer.Serialize(details) });
    }
    private async Task<Vehicle> Vehicle(Guid id, long version, ResourceAccess access, string permission, CancellationToken ct)
    {
        var vehicle = await VehicleAccess.Query(db, access, permission).SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw UserAccounts.Error(404, "vehicle_not_found", "A jármű nem található ennél a cégnél.");
        if (version < 1) throw UserAccounts.Error(400, "invalid_version", "Add meg a jármű aktuális verzióját.");
        if (vehicle.Version != version) throw UserAccounts.Error(409, "stale_vehicle", "A jármű időközben megváltozott. Töltsd be újra az adatait.");
        if (vehicle.Status == VehicleStatus.Archived) throw UserAccounts.Error(409, "vehicle_archived", "Előbb állítsd vissza az archivált járművet.");
        return vehicle;
    }
    public Task<VehicleSummary> CreateAsync(CreateVehicleRequest request, CancellationToken ct) => Authorized(Permissions.VehiclesCreate, async access =>
    {
        if (!access.Allows(Permissions.VehiclesCreate, request.SiteId))
            throw UserAccounts.Error(403, "site_access_denied", "Járművet csak engedélyezett telephelyre vehetsz fel.");
        if (request.SiteId is { } siteId && !await db.Sites.AnyAsync(x => x.Id == siteId && !x.IsArchived, ct))
            throw UserAccounts.Error(400, "invalid_site", "Válassz aktív telephelyet ennél a cégnél.");
        var vehicle = new Vehicle { TenantId = TenantId, Registration = FleetManagement.NormalizeRegistration(request.Registration), Make = request.Make.Trim(), Model = request.Model.Trim() };
        db.Vehicles.Add(vehicle);
        db.VehicleProfiles.Add(new() { TenantId = TenantId, VehicleId = vehicle.Id });
        db.VehicleRegistrations.Add(new() { TenantId = TenantId, VehicleId = vehicle.Id, Registration = vehicle.Registration, CountryCode = "HU", RecordedBy = tenantContext.UserSubject! });
        if (request.SiteId is { } site) db.VehicleSiteAssignments.Add(new() { TenantId = TenantId, VehicleId = vehicle.Id, SiteId = site });
        Audit("vehicle.created", new { vehicle.Id, vehicle.Registration, vehicle.Make, vehicle.Model, request.SiteId });
        await db.SaveChangesAsync(ct);
        return await Summary(vehicle, access, ct);
    }, ct);
    public Task<VehicleSummary> UpdateAsync(Guid id, UpdateVehicleRequest request, CancellationToken ct) => Authorized(Permissions.VehiclesUpdate, async access =>
    {
        var vehicle = await Vehicle(id, request.Version, access, Permissions.VehiclesUpdate, ct);
        var before = await Summary(vehicle, access, ct);
        var registration = FleetManagement.NormalizeRegistration(request.Registration);
        if (registration != vehicle.Registration)
        {
            var country = await db.VehicleProfiles.Where(x => x.VehicleId == id).Select(x => x.RegistrationCountry).SingleOrDefaultAsync(ct) ?? "HU";
            db.VehicleRegistrations.Add(new() { TenantId = TenantId, VehicleId = id, Registration = registration, CountryCode = country, RecordedBy = tenantContext.UserSubject! });
        }
        vehicle.Registration = registration;
        vehicle.Make = request.Make.Trim();
        vehicle.Model = request.Model.Trim();
        vehicle.Version++;
        var after = await Summary(vehicle, access, ct);
        Audit("vehicle.updated", new { vehicleId = id, before, after });
        await db.SaveChangesAsync(ct);
        return after;
    }, ct);
    public Task<VehicleSummary> RecordOdometerAsync(Guid id, RecordOdometerRequest request, CancellationToken ct) => Authorized(Permissions.OdometerCreate, async access =>
    {
        var vehicle = await Vehicle(id, request.Version, access, Permissions.OdometerCreate, ct);
        if (request.Kilometers is null or < 0 or > 100_000_000 || request.Kilometers < vehicle.OdometerKm)
            throw UserAccounts.Error(400, "invalid_odometer", "A kilométerállás 0–100 000 000 közötti egész szám legyen, és nem lehet kisebb az előzőnél.");
        var reading = new OdometerReading { TenantId = TenantId, VehicleId = id, Kilometers = request.Kilometers.Value, RecordedBy = tenantContext.UserSubject! };
        db.OdometerReadings.Add(reading);
        var before = vehicle.OdometerKm;
        vehicle.OdometerKm = request.Kilometers;
        vehicle.Version++;
        Audit("vehicle.odometer_recorded", new { vehicleId = id, readingId = reading.Id, before, after = request.Kilometers, version = vehicle.Version });
        await db.SaveChangesAsync(ct);
        return await Summary(vehicle, access, ct);
    }, ct);
}
