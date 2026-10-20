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
            var admin = new PermissionGroup { CreatedBy = subject, Name = "admin", NormalizedName = "ADMIN", IsAdmin = true, AllPermissions = true };
            admin.Companies.Add( new GroupCompany { TenantId = tenant.Id, GroupId = admin.Id });
            db.PermissionGroups.Add(admin);
            db.GroupUsers.Add(new GroupUser { GroupId = admin.Id, UserId = subject });
            db.Memberships.Add(new TenantMembership
            {
                TenantId = tenant.Id, UserSubject = subject, JoinedAt = DateTimeOffset.UtcNow,
                Groups = [new MembershipGroup { TenantId = tenant.Id, UserSubject = subject, GroupId = admin.Id, Group = admin }]
            });
            db.AccessAuditEvents.Add(new AccessAuditEvent { TenantId = tenant.Id, ActorSubject = subject, Action = "company.created", TargetSubject = subject, Details = System.Text.Json.JsonSerializer.Serialize(new { permissions = Permissions.All, adminGroupId = admin.Id }) });
            UserAccounts.Audit(db, subject, subject, "company.created", new { tenant.Name, permissions = Permissions.All, adminGroupId = admin.Id }, tenant.Id);
            await db.SaveChangesAsync(cancellationToken);
            return new TenantSummary(tenant.Id, tenant.Name, Permissions.All);
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<TenantSummary>> ListForUserAsync(string subject, CancellationToken cancellationToken)
    {
        if (await UserAccounts.IsSystemManager(db, subject, cancellationToken))
            return await db.Tenants.AsNoTracking().OrderBy(x => x.Name).Select(x => new TenantSummary(x.Id, x.Name, Permissions.All)).ToArrayAsync(cancellationToken);
        var companies = await (from membership in db.Memberships.AsNoTracking()
                  join tenant in db.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
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
            if (member.HasCompanyAccess) result.Add(new(company.Id, company.Name, member.EffectivePermissions));
        }
        return result;
    }

    public async Task<TenantMembership?> FindMembershipAsync(string subject, Guid tenantId, CancellationToken cancellationToken)
    {
        if (await UserAccounts.IsSystemManager(db, subject, cancellationToken)
            && await db.Tenants.AnyAsync(x => x.Id == tenantId, cancellationToken)) return SystemMembership(subject, tenantId);
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
    private static VehicleSummary Summary(Vehicle x) => new(x.Id, x.Registration, x.Make, x.Model, x.Status.ToString()) { Version = x.Version, OdometerKm = x.OdometerKm };
    public Task<VehicleSummary?> GetAsync(Guid id, CancellationToken ct) => TenantTransaction.RunAsync<VehicleSummary?>(db, TenantId, async () =>
        await db.Vehicles.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct) is { } vehicle ? Summary(vehicle) : null, ct);
    public Task<IReadOnlyList<VehicleSummary>> ListAsync(CancellationToken ct) => TenantTransaction.RunAsync<IReadOnlyList<VehicleSummary>>(db, TenantId, async () =>
        (await db.Vehicles.AsNoTracking().OrderBy(x => x.Registration).ToListAsync(ct)).Select(Summary).ToArray(), ct);
    private Task<VehicleSummary> Write(string permission, Func<Task<VehicleSummary>> action, CancellationToken ct) => TenantTransaction.RunAsync(db, TenantId, async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, TenantId, ct);
        await AccessRules.Authorize(db, TenantId, tenantContext.UserSubject!, permission, ct);
        return await action();
    }, ct);
    private void Audit(string action, object details)
    {
        UserAccounts.Audit(db, tenantContext.UserSubject!, null, action, details, TenantId);
        db.AccessAuditEvents.Add(new() { TenantId = TenantId, ActorSubject = tenantContext.UserSubject!, Action = action, Details = System.Text.Json.JsonSerializer.Serialize(details) });
    }
    private async Task<Vehicle> Vehicle(Guid id, long version, CancellationToken ct)
    {
        var vehicle = await db.Vehicles.SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw UserAccounts.Error(404, "vehicle_not_found", "A jármű nem található ennél a cégnél.");
        if (version < 1) throw UserAccounts.Error(400, "invalid_version", "Add meg a jármű aktuális verzióját.");
        if (vehicle.Version != version) throw UserAccounts.Error(409, "stale_vehicle", "A jármű időközben megváltozott. Töltsd be újra az adatait.");
        return vehicle;
    }
    public Task<VehicleSummary> CreateAsync(CreateVehicleRequest request, CancellationToken ct) => Write(Permissions.VehiclesCreate, async () =>
    {
        var vehicle = new Vehicle { TenantId = TenantId, Registration = request.Registration.Trim().Replace(" ", "").ToUpperInvariant(), Make = request.Make.Trim(), Model = request.Model.Trim() };
        db.Vehicles.Add(vehicle);
        Audit("vehicle.created", new { vehicle.Id, vehicle.Registration, vehicle.Make, vehicle.Model });
        await db.SaveChangesAsync(ct);
        return Summary(vehicle);
    }, ct);
    public Task<VehicleSummary> UpdateAsync(Guid id, UpdateVehicleRequest request, CancellationToken ct) => Write(Permissions.VehiclesUpdate, async () =>
    {
        var vehicle = await Vehicle(id, request.Version, ct);
        var before = Summary(vehicle);
        vehicle.Registration = request.Registration.Trim().Replace(" ", "").ToUpperInvariant();
        vehicle.Make = request.Make.Trim();
        vehicle.Model = request.Model.Trim();
        vehicle.Version++;
        Audit("vehicle.updated", new { vehicleId = id, before, after = Summary(vehicle) });
        await db.SaveChangesAsync(ct);
        return Summary(vehicle);
    }, ct);
    public Task<VehicleSummary> RecordOdometerAsync(Guid id, RecordOdometerRequest request, CancellationToken ct) => Write(Permissions.OdometerCreate, async () =>
    {
        var vehicle = await Vehicle(id, request.Version, ct);
        if (request.Kilometers is null or < 0 or > 100_000_000 || request.Kilometers < vehicle.OdometerKm)
            throw UserAccounts.Error(400, "invalid_odometer", "A kilométerállás 0–100 000 000 közötti egész szám legyen, és nem lehet kisebb az előzőnél.");
        var reading = new OdometerReading { TenantId = TenantId, VehicleId = id, Kilometers = request.Kilometers.Value, RecordedBy = tenantContext.UserSubject! };
        db.OdometerReadings.Add(reading);
        var before = vehicle.OdometerKm;
        vehicle.OdometerKm = request.Kilometers;
        vehicle.Version++;
        Audit("vehicle.odometer_recorded", new { vehicleId = id, readingId = reading.Id, before, after = request.Kilometers, version = vehicle.Version });
        await db.SaveChangesAsync(ct);
        return Summary(vehicle);
    }, ct);
}
