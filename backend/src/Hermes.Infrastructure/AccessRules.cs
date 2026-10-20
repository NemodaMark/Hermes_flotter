using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

internal static class AccessRules
{
    internal static IQueryable<TenantMembership> WithAccess(this IQueryable<TenantMembership> query)
        => query.Include(x => x.Permissions)
            .Include(x => x.Groups).ThenInclude(x => x.Group).ThenInclude(x => x.Permissions).AsSplitQuery();

    internal static AssignedGroup[] Groups(TenantMembership member) => member.Groups
        .Select(x => new AssignedGroup(x.GroupId, x.Group.Name, x.Group.IsAdmin)).OrderBy(x => x.Name).ToArray();
    internal static TenantAccess Access(TenantMembership member) => new(member.TenantId, member.UserSubject, member.IsActive, member.Version, member.EffectivePermissions)
    { DirectPermissions = member.Permissions.Select(x => x.Code).Order(StringComparer.Ordinal).ToArray(), Groups = Groups(member) };

    internal static async Task LockTenant(HermesDbContext db, Guid tenantId, CancellationToken ct)
    {
        if (await db.Tenants.FromSqlInterpolated($"SELECT * FROM tenants WHERE \"Id\" = {tenantId} FOR UPDATE").AsNoTracking().SingleOrDefaultAsync(ct) is null)
            throw UserAccounts.Error(404, "tenant_not_found", "A cég nem található.");
    }

    // Call inside the tenant transaction, after the global shared lock and company row lock.
    internal static async Task<TenantMembership> Authorize(HermesDbContext db, Guid tenantId, string subject, string permission, CancellationToken ct)
    {
        if (await UserAccounts.IsSystemManager(db, subject, ct)) return TenantDirectory.SystemMembership(subject, tenantId);
        var member = await db.Memberships.AsNoTracking().WithAccess().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserSubject == subject && x.IsActive, ct);
        if (member is null || !member.HasCompanyAccess || !member.EffectivePermissions.Contains(permission))
            throw UserAccounts.Error(403, "permission_denied", "Ehhez a művelethez nincs jogosultságod.");
        return member;
    }

    internal static string[] Validate(string[]? permissions)
    {
        if (permissions is null || permissions.Length > Permissions.Catalog.Count || permissions.Any(x => x is null || !Permissions.All.Contains(x)) || permissions.Distinct().Count() != permissions.Length)
            throw UserAccounts.Error(400, "invalid_permissions", "Csak a katalógusban szereplő, ismétlés nélküli jogosultságok adhatók meg.");
        return permissions.Order(StringComparer.Ordinal).ToArray();
    }
    internal static void Delegate(TenantMembership actor, IEnumerable<string> permissions)
    {
        if (permissions.Except(actor.EffectivePermissions).Any())
            throw UserAccounts.Error(403, "delegation_denied", "Csak a saját jogosultságaid körén belül adhatsz vagy vonhatsz vissza hozzáférést.");
    }
    internal static ManagementException LastManager() => UserAccounts.Error(409, "last_permission_manager", "Az utolsó aktív jogosultságkezelő hozzáférése nem szüntethető meg. Előbb adj másik aktív tagnak jogosultságkezelési jogot.");
}
