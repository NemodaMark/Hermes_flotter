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

    internal static IQueryable<Vehicle> Filter(HermesDbContext db, IQueryable<Vehicle> query, string site, string status, string? searchText)
    {
        if (status != "all")
        {
            if (!Enum.TryParse<VehicleStatus>(status, out var parsed) || !Enum.IsDefined(parsed) || parsed.ToString() != status)
                throw UserAccounts.Error(400, "invalid_status", "Válassz érvényes járműállapotot.");
            query = query.Where(v => v.Status == parsed);
        }
        if (site == "none")
            query = query.Where(v => !db.VehicleSiteAssignments.Any(a => a.VehicleId == v.Id && a.TenantId == v.TenantId));
        else if (site != "all")
        {
            if (!Guid.TryParse(site, out var siteId) || siteId == Guid.Empty)
                throw UserAccounts.Error(400, "invalid_site", "Érvénytelen telephelyszűrő.");
            query = query.Where(v => db.VehicleSiteAssignments.Any(a => a.VehicleId == v.Id && a.TenantId == v.TenantId && a.SiteId == siteId));
        }

        var search = searchText?.Trim() ?? "";
        if (search.Length > 200)
            throw UserAccounts.Error(400, "invalid_search", "A keresés legfeljebb 200 karakter lehet.");
        if (search.Length == 0) return query;

        // Search text is literal, including SQL wildcard characters.
        var pattern = "%" + search.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
        return query.Where(v => EF.Functions.ILike(EF.Functions.Collate(v.Registration + " " + v.Make + " " + v.Model, "pg_c_utf8"), pattern, "\\")
            || db.VehicleRegistrations.Any(r => r.VehicleId == v.Id && r.TenantId == v.TenantId
                && EF.Functions.ILike(EF.Functions.Collate(r.Registration, "pg_c_utf8"), pattern, "\\")));
    }

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
