using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Api.Tests;

public static class TestFleetData
{
    public static readonly Guid DunaId = Guid.Parse("10000000-0000-4000-8000-000000000001");
    public static readonly Guid PannonId = Guid.Parse("10000000-0000-4000-8000-000000000002");

    public static async Task ApplyAsync(HermesDbContext db, TenantContext tenantContext, CancellationToken cancellationToken = default)
    {
        if (!await db.Tenants.AnyAsync(cancellationToken))
        {
            db.Tenants.AddRange(
                new Tenant { Id = DunaId, Name = "Duna Logisztika" },
                new Tenant { Id = PannonId, Name = "Pannon Szerviz" });
            db.Memberships.AddRange(
                new TenantMembership { TenantId = DunaId, UserSubject = "test:anna", Role = FleetRole.Owner },
                new TenantMembership { TenantId = PannonId, UserSubject = "test:anna", Role = FleetRole.FleetManager },
                new TenantMembership { TenantId = DunaId, UserSubject = "test:bela", Role = FleetRole.Viewer });
            await db.SaveChangesAsync(cancellationToken);
        }

        // This method is called with a fresh context per tenant by the migration command.
        var tenantId = tenantContext.TenantId ?? throw new InvalidOperationException("Seed tenant is required.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {tenantId.ToString()}, true)", cancellationToken);
        if (!await db.Vehicles.AnyAsync(cancellationToken))
        {
            db.Vehicles.AddRange(tenantId == DunaId
                ? [new Vehicle { TenantId = tenantId, Registration = "AA-BB-123", Make = "Škoda", Model = "Octavia" },
                   new Vehicle { TenantId = tenantId, Registration = "HER-204", Make = "Ford", Model = "Transit", Status = VehicleStatus.Maintenance }]
                : [new Vehicle { TenantId = tenantId, Registration = "PAN-310", Make = "Volkswagen", Model = "Caddy" }]);
            await db.SaveChangesAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }
}
