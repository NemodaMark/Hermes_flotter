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
            await db.SaveChangesAsync(cancellationToken);
        }

        // This method is called with a fresh context per tenant by the migration command.
        var tenantId = tenantContext.TenantId ?? throw new InvalidOperationException("Seed tenant is required.");
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {tenantId.ToString()}, true)", cancellationToken);
        if (!await db.Memberships.AnyAsync(item => item.TenantId == tenantId, cancellationToken))
        {
            TenantMembership Membership(string user, string[] permissions) => new()
            {
                TenantId = tenantId, UserSubject = user,
                Permissions = permissions.Select(code => new MembershipPermission { TenantId = tenantId, UserSubject = user, Code = code }).ToList()
            };
            db.Memberships.Add(Membership("anna", tenantId == DunaId ? Permissions.All : [Permissions.VehiclesRead, Permissions.VehiclesCreate]));
            if (tenantId == DunaId) db.Memberships.Add(Membership("bela", [Permissions.VehiclesRead]));
        }
        if (!await db.PermissionGroups.AnyAsync(cancellationToken)) db.PermissionGroups.Add(new() { TenantId = tenantId, Name = "admin", NormalizedName = "ADMIN", IsAdmin = true });
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
