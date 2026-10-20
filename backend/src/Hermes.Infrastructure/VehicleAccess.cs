using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

internal static class VehicleAccess
{
    internal static IQueryable<Vehicle> Query(HermesDbContext db, ResourceAccess access, string permission)
    {
        if (access.CompanyWide(permission)) return db.Vehicles;
        var sites = access.Sites(permission);
        return db.Vehicles.Where(v => db.VehicleSiteAssignments.Any(a => a.VehicleId == v.Id && a.TenantId == v.TenantId && sites.Contains(a.SiteId)));
    }
    internal static string[] PermissionsFor(ResourceAccess access, Guid? site) => Domain.Permissions.All
        .Where(code => ResourceAccess.IsScoped(code) && access.Allows(code, site)).ToArray();

    internal static async Task<IQueryable<AccessAuditEvent>> AuditQuery(HermesDbContext db, ResourceAccess access, CancellationToken ct)
    {
        if (access.CompanyWide(Domain.Permissions.AuditRead)) return db.AccessAuditEvents;
        var vehicles = (await Query(db, access, Domain.Permissions.AuditRead).Select(x => x.Id).ToArrayAsync(ct)).Select(x => x.ToString()).ToArray();
        var sites = access.Sites(Domain.Permissions.AuditRead).Select(x => x.ToString()).ToArray();
        // The existing tenant query filter and RLS still apply to this composable query.
        return db.AccessAuditEvents.FromSqlInterpolated($"""
            SELECT * FROM access_audit_events e WHERE CASE
                WHEN e."Action" LIKE 'vehicle.%' OR e."Action" = 'site.vehicle_assigned'
                    THEN coalesce(e."Details"->>'vehicleId',e."Details"->>'entityId',e."Details"->>'Id') = ANY({vehicles})
                WHEN e."Action" LIKE 'site.%'
                    THEN coalesce(e."Details"->>'entityId',e."Details"->>'siteId',e."Details"->>'Id') = ANY({sites})
                ELSE true END
            """);
    }
}
