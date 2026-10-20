using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class GroupManagement(HermesDbContext db, TenantContext context) : IGroupManagement
{
    private Guid TenantId => context.TenantId!.Value;
    private string Actor => context.UserSubject!;
    private Task<T> Scoped<T>(Func<Task<T>> action, CancellationToken ct) => TenantTransaction.RunAsync(db, TenantId, action, ct);
    private Task<T> Authorized<T>(string permission, Func<TenantMembership, Task<T>> action, CancellationToken ct) => Scoped(async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, TenantId, ct);
        return await action(await AccessRules.Authorize(db, TenantId, Actor, permission, ct));
    }, ct);
    private void Audit(string action, string? target, object details)
    {
        db.AccessAuditEvents.Add(new() { TenantId = TenantId, ActorSubject = Actor, Action = action, TargetSubject = target, Details = JsonSerializer.Serialize(details) });
        UserAccounts.Audit(db, Actor, target, action, details, TenantId);
    }
    private static string Name(string? name)
    {
        var value = name?.Trim() ?? "";
        if (value.Length is < 1 or > 80 || value.Any(char.IsControl)) throw UserAccounts.Error(400, "invalid_group_name", "Adj meg egy legfeljebb 80 karakteres csoportnevet.");
        if (value.Equals("admin", StringComparison.OrdinalIgnoreCase)) throw Protected();
        return value;
    }
    private static ManagementException Protected() => UserAccounts.Error(409, "protected_admin_group", "Az admin csoport neve és jogai automatikusan kezeltek; a csoport nem törölhető.");
    private async Task Unique(string name, Guid? except, CancellationToken ct)
    {
        if (await db.PermissionGroups.AnyAsync(x => x.NormalizedName == name.ToUpperInvariant() && x.Id != except, ct))
            throw UserAccounts.Error(409, "group_name_exists", "Ebben a cégben már van ilyen nevű csoport.");
    }
    private async Task<PermissionGroup> Group(Guid id, CancellationToken ct) =>
        await db.PermissionGroups.Include(x => x.Permissions).SingleOrDefaultAsync(x => x.Id == id, ct)
        ?? throw UserAccounts.Error(404, "group_not_found", "A csoport nem található ennél a cégnél.");
    private static void Version(long actual, long expected)
    {
        if (expected < 1) throw UserAccounts.Error(400, "invalid_version", "Add meg az aktuális verziót.");
        if (actual != expected) throw UserAccounts.Error(409, "stale_group", "Az adatok időközben megváltoztak. Töltsd be újra őket.");
    }
    private async Task<PermissionGroupSummary> Summary(PermissionGroup group, CancellationToken ct) => new(group.Id, group.Name, group.IsAdmin, group.Version,
        group.EffectivePermissions.Order(StringComparer.Ordinal).ToArray(), await db.MembershipGroups.CountAsync(x => x.GroupId == group.Id, ct));

    public Task<PermissionGroupSummary[]> ListAsync(CancellationToken ct) => Scoped(async () =>
    {
        if (!context.Permissions.Overlaps(new[] { Permissions.GroupsManage, Permissions.Manage, Permissions.MembersRead }))
            throw UserAccounts.Error(403, "permission_denied", "Ehhez a művelethez nincs jogosultságod.");
        var groups = await db.PermissionGroups.AsNoTracking().Include(x => x.Permissions).OrderByDescending(x => x.IsAdmin).ThenBy(x => x.Name).ToArrayAsync(ct);
        var counts = await db.MembershipGroups.GroupBy(x => x.GroupId).Select(x => new { Id = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        return groups.Select(x => new PermissionGroupSummary(x.Id, x.Name, x.IsAdmin, x.Version, x.EffectivePermissions.Order(StringComparer.Ordinal).ToArray(), counts.GetValueOrDefault(x.Id))).ToArray();
    }, ct);

    public Task<PermissionGroupSummary> CreateAsync(CreateGroupRequest request, CancellationToken ct) => Authorized(Permissions.GroupsManage, async actor =>
    {
        var name = Name(request.Name);
        var codes = AccessRules.Validate(request.Permissions);
        AccessRules.Delegate(actor, codes);
        await Unique(name, null, ct);
        var group = new PermissionGroup { TenantId = TenantId, Name = name, NormalizedName = name.ToUpperInvariant() };
        group.Permissions = codes.Select(code => new GroupPermission { TenantId = TenantId, GroupId = group.Id, Code = code }).ToList();
        db.PermissionGroups.Add(group);
        Audit("group.created", null, new { groupId = group.Id, name, permissions = codes });
        await db.SaveChangesAsync(ct);
        return await Summary(group, ct);
    }, ct);

    // A definition change affects every assigned member. Evaluate the resulting effective rights before saving.
    private async Task ProtectManagers(Guid groupId, string[] after, CancellationToken ct)
    {
        var members = await db.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == TenantId && x.IsActive).ToListAsync(ct);
        if (members.Any(x => x.EffectivePermissions.Contains(Permissions.Manage)) && !members.Any(x =>
            x.Permissions.Any(p => p.Code == Permissions.Manage) || x.CompanyGroups.Any(g => g.Group.EffectivePermissions.Contains(Permissions.Manage))
                || x.Groups.Any(g => (g.GroupId == groupId ? after : g.Group.EffectivePermissions).Contains(Permissions.Manage))))
            throw AccessRules.LastManager();
    }
    public Task<PermissionGroupSummary> UpdateAsync(Guid id, UpdateGroupRequest request, CancellationToken ct) => Authorized(Permissions.GroupsManage, async actor =>
    {
        var group = await Group(id, ct);
        if (group.IsAdmin) throw Protected();
        Version(group.Version, request.Version);
        var name = Name(request.Name);
        var codes = AccessRules.Validate(request.Permissions);
        var before = new { group.Name, permissions = group.EffectivePermissions };
        // Editing a bundle requires authority over the entire bundle, including unchanged rights.
        AccessRules.Delegate(actor, group.EffectivePermissions.Concat(codes));
        await Unique(name, id, ct);
        await ProtectManagers(id, codes, ct);
        foreach (var removed in group.Permissions.Where(x => !codes.Contains(x.Code)).ToArray())
        { group.Permissions.Remove(removed); db.GroupPermissions.Remove(removed); }
        foreach (var code in codes.Except(group.EffectivePermissions)) group.Permissions.Add(new() { TenantId = TenantId, GroupId = id, Code = code });
        group.Name = name;
        group.NormalizedName = name.ToUpperInvariant();
        group.Version++;
        Audit("group.updated", null, new { groupId = id, before, after = new { name, permissions = codes }, version = group.Version });
        await db.SaveChangesAsync(ct);
        return await Summary(group, ct);
    }, ct);

    public async Task DeleteAsync(Guid id, long version, CancellationToken ct) => _ = await Authorized(Permissions.GroupsManage, async actor =>
    {
        var group = await Group(id, ct);
        if (group.IsAdmin) throw Protected();
        Version(group.Version, version);
        AccessRules.Delegate(actor, group.EffectivePermissions);
        await ProtectManagers(id, [], ct);
        var assignments = await db.MembershipGroups.Where(x => x.GroupId == id).ToListAsync(ct);
        var subjects = assignments.Select(x => x.UserSubject).ToArray();
        foreach (var member in await db.Memberships.Where(x => x.TenantId == TenantId && subjects.Contains(x.UserSubject)).ToListAsync(ct)) member.Version++;
        db.MembershipGroups.RemoveRange(assignments);
        // Restrict FK requires removing assignments before the group, in the same transaction.
        await db.SaveChangesAsync(ct);
        db.PermissionGroups.Remove(group);
        Audit("group.deleted", null, new { groupId = id, group.Name, permissions = group.EffectivePermissions, affectedUsers = subjects });
        await db.SaveChangesAsync(ct);
        return true;
    }, ct);

    public Task<TenantAccess> AssignAsync(string userId, ChangeGroupsRequest request, CancellationToken ct) => Authorized(Permissions.Manage, async actor =>
    {
        if (request.GroupIds is null || request.GroupIds.Length > 100 || request.GroupIds.Distinct().Count() != request.GroupIds.Length)
            throw UserAccounts.Error(400, "invalid_groups", "Legfeljebb 100 különböző csoport adható meg.");
        var target = await db.Memberships.WithAccess().SingleOrDefaultAsync(x => x.TenantId == TenantId && x.UserSubject == userId, ct)
            ?? throw UserAccounts.Error(404, "member_not_found", "A céges felhasználó nem található.");
        Version(target.Version, request.Version);
        var desired = await db.PermissionGroups.Include(x => x.Permissions).Where(x => request.GroupIds.Contains(x.Id)).ToListAsync(ct);
        if (desired.Count != request.GroupIds.Length) throw UserAccounts.Error(404, "group_not_found", "Egy csoport nem található ennél a cégnél.");
        var before = target.Groups.Select(x => x.GroupId).ToArray();
        var changed = desired.Where(x => !before.Contains(x.Id)).Concat(target.Groups.Where(x => !request.GroupIds.Contains(x.GroupId)).Select(x => x.Group)).ToArray();
        AccessRules.Delegate(actor, changed.SelectMany(x => x.EffectivePermissions));
        if (changed.Any(x => x.IsAdmin) && !actor.HasAdminAuthority && !await UserAccounts.IsSystemManager(db, Actor, ct))
            throw UserAccounts.Error(403, "admin_delegation_denied", "Az automatikusan bővülő admin hozzáférést céges admin vagy rendszergazda oszthatja ki.");
        var afterPermissions = target.Permissions.Select(x => x.Code).Concat(desired.SelectMany(x => x.EffectivePermissions))
            .Concat(target.CompanyGroups.SelectMany(x => x.Group.EffectivePermissions)).ToArray();
        if (target.IsActive && target.EffectivePermissions.Contains(Permissions.Manage) && !afterPermissions.Contains(Permissions.Manage))
        {
            var others = await db.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == TenantId && x.IsActive && x.UserSubject != userId).ToListAsync(ct);
            if (!others.Any(x => x.EffectivePermissions.Contains(Permissions.Manage))) throw AccessRules.LastManager();
        }
        foreach (var removed in target.Groups.Where(x => !request.GroupIds.Contains(x.GroupId)).ToArray())
        { target.Groups.Remove(removed); db.MembershipGroups.Remove(removed); }
        foreach (var added in desired.Where(x => !before.Contains(x.Id))) target.Groups.Add(new() { TenantId = TenantId, UserSubject = userId, GroupId = added.Id, Group = added });
        if (desired.Count > 0) target.HasDirectAccess = true;
        target.Version++;
        Audit("member.groups_changed", userId, new { before, after = request.GroupIds, version = target.Version });
        await db.SaveChangesAsync(ct);
        return AccessRules.Access(target);
    }, ct);
}
