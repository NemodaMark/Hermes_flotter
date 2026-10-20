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
            db.Tenants.Add(tenant);
            db.Memberships.Add(new TenantMembership
            {
                TenantId = tenant.Id, UserSubject = subject, JoinedAt = DateTimeOffset.UtcNow,
                Permissions = Permissions.All.Select(code => new MembershipPermission { TenantId = tenant.Id, UserSubject = subject, Code = code }).ToList()
            });
            db.AccessAuditEvents.Add(new AccessAuditEvent { TenantId = tenant.Id, ActorSubject = subject, Action = "company.created", TargetSubject = subject, Details = System.Text.Json.JsonSerializer.Serialize(new { permissions = Permissions.All }) });
            await db.SaveChangesAsync(cancellationToken);
            return new TenantSummary(tenant.Id, tenant.Name, Permissions.All);
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<TenantSummary>> ListForUserAsync(string subject, CancellationToken cancellationToken)
    {
        var companies = await (from membership in db.Memberships.AsNoTracking()
                  join tenant in db.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
                  where membership.UserSubject == subject && membership.IsActive
                  orderby tenant.Name
                  select new { tenant.Id, tenant.Name })
            .ToListAsync(cancellationToken);
        var result = new List<TenantSummary>();
        foreach (var company in companies)
        {
            var permissions = await TenantTransaction.RunAsync(db, company.Id, () => db.MembershipPermissions.IgnoreQueryFilters()
                .Where(permission => permission.TenantId == company.Id && permission.UserSubject == subject)
                .OrderBy(permission => permission.Code).Select(permission => permission.Code).ToArrayAsync(cancellationToken), cancellationToken);
            result.Add(new(company.Id, company.Name, permissions));
        }
        return result;
    }

    public Task<TenantMembership?> FindMembershipAsync(string subject, Guid tenantId, CancellationToken cancellationToken)
        => TenantTransaction.RunAsync(db, tenantId, () => db.Memberships.AsNoTracking().Include(x => x.Permissions)
            .IgnoreQueryFilters().SingleOrDefaultAsync(x => x.UserSubject == subject && x.TenantId == tenantId && x.IsActive, cancellationToken), cancellationToken);
}

public sealed class VehicleStore(HermesDbContext db, ITenantContext tenantContext) : IVehicleStore
{
    public Task<VehicleSummary?> GetAsync(Guid id, CancellationToken cancellationToken)
        => InTenantTransactionAsync(() => db.Vehicles.AsNoTracking().Where(x => x.Id == id)
            .Select(x => new VehicleSummary(x.Id, x.Registration, x.Make, x.Model, x.Status.ToString()))
            .SingleOrDefaultAsync(cancellationToken), cancellationToken);

    public Task<IReadOnlyList<VehicleSummary>> ListAsync(CancellationToken cancellationToken)
        => InTenantTransactionAsync<IReadOnlyList<VehicleSummary>>(async () =>
            await db.Vehicles.AsNoTracking().OrderBy(x => x.Registration)
                .Select(x => new VehicleSummary(x.Id, x.Registration, x.Make, x.Model, x.Status.ToString()))
                .ToListAsync(cancellationToken), cancellationToken);

    public Task<VehicleSummary> CreateAsync(CreateVehicleRequest request, CancellationToken cancellationToken)
        => InTenantTransactionAsync(async () =>
        {
            var vehicle = new Vehicle
            {
                TenantId = tenantContext.TenantId!.Value,
                Registration = request.Registration.Trim().Replace(" ", "").ToUpperInvariant(),
                Make = request.Make.Trim(),
                Model = request.Model.Trim()
            };
            db.Vehicles.Add(vehicle);
            await db.SaveChangesAsync(cancellationToken);
            return new VehicleSummary(vehicle.Id, vehicle.Registration, vehicle.Make, vehicle.Model, vehicle.Status.ToString());
        }, cancellationToken);

    private async Task<T> InTenantTransactionAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context is required.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        // Transaction-local settings cannot leak to the next user of a pooled connection.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('app.tenant_id', {tenantId.ToString()}, true)", cancellationToken);
        var result = await operation();
        await transaction.CommitAsync(cancellationToken);
        return result;
    }
}
