using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hermes.Infrastructure;

public sealed class GroupManagement(HermesDbContext db, UserAccounts accounts) : IGroupManagement
{
    private sealed record State(string Name, bool AllPermissions, string[] Permissions, Guid[] CompanyIds, GroupSiteSelection[]? SiteScopes = null,
        string DashboardMode = "Overview", int DashboardPriority = 0);
    private static void ValidateDashboard(string mode, int priority)
    {
        if (mode is not ("Overview" or "Vehicle") || priority is < 0 or > 1000)
            throw UserAccounts.Error(400, "invalid_dashboard", "Válassz áttekintő vagy autós kezdőnézetet és 0–1000 közötti prioritást.");
    }
    private static ManagementException Denied() => UserAccounts.Error(403, "group_permission_denied", "Minden érintett cégnél rendelkezned kell a művelethez és a kiosztandó jogokhoz szükséges hozzáféréssel.");
    private Task<T> Run<T>(bool write, Func<Task<T>> action, CancellationToken ct) => RunCore(write, action, ct);
    private async Task<T> RunCore<T>(bool write, Func<Task<T>> action, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        // Cross-company writes take the exclusive lock; existing tenant writes take its shared counterpart.
        await UserAccounts.LockSystemAccess(db, ct, shared: !write);
        var result = await action();
        await transaction.CommitAsync(ct);
        return result;
    }
    private async Task<T> InCompany<T>(Guid id, string actor, Func<HermesDbContext, Task<T>> action, CancellationToken ct)
    {
        var context = new TenantContext(); context.Set(id, actor, []);
        var options = new DbContextOptionsBuilder<HermesDbContext>().UseNpgsql(db.Database.GetDbConnection()).Options;
        await using var scoped = new HermesDbContext(options, context);
        await scoped.Database.UseTransactionAsync(db.Database.CurrentTransaction!.GetDbTransaction(), ct);
        await scoped.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {id.ToString()}, true)", ct);
        return await action(scoped);
    }
    private async Task<GroupCompanyOption[]> Choices(string actor, CancellationToken ct)
    {
        var system = await UserAccounts.IsSystemManager(db, actor, ct);
        var companies = system ? db.Tenants.AsNoTracking()
            : db.Tenants.AsNoTracking().Where(t => db.Memberships.Any(m => m.TenantId == t.Id && m.UserSubject == actor && m.IsActive));
        var candidates = await companies.OrderBy(x => x.Name).ToArrayAsync(ct);
        var choices = new List<GroupCompanyOption>();
        foreach (var candidate in candidates)
        {
            var choice = await InCompany(candidate.Id, actor, async scoped =>
            {
                var member = system ? TenantDirectory.SystemMembership(actor, candidate.Id)
                    : await scoped.Memberships.AsNoTracking().WithAccess().SingleAsync(x => x.TenantId == candidate.Id && x.UserSubject == actor, ct);
                var codes = member.EffectivePermissions;
                if (!member.HasCompanyAccess || !codes.Intersect([Permissions.GroupsManage, Permissions.Manage, Permissions.MembersRead]).Any()) return null;
                return new GroupCompanyOption(candidate.Id, candidate.Name, codes, codes.Contains(Permissions.GroupsManage), codes.Contains(Permissions.Manage), system || member.HasAdminAuthority)
                {
                    Sites = await scoped.Sites.AsNoTracking().OrderBy(x => x.Name).Select(x => new GroupSiteOption(x.Id, x.Name, x.Code, x.IsArchived)).ToArrayAsync(ct),
                    PermissionScopes = new ResourceAccess(member).Describe()
                };
            }, ct);
            if (choice is not null) choices.Add(choice);
        }
        return choices.ToArray();
    }
    public Task<GroupCompanyOption[]> CompaniesAsync(string actor, CancellationToken ct) => Run(false, () => Choices(actor, ct), ct);
    private static bool Allows(GroupCompanyOption[] choices, Guid[] ids, string[] codes, bool all, bool edit, bool assign, GroupSiteSelection[]? scopes = null)
        => ids.Length > 0 && ids.All(id => choices.Any(x => x.Id == id && (!edit || x.CanEdit) && (!assign || x.CanAssign)
            && (!all || x.CanGrantAll) && codes.All(code => CanDelegate(x, code, scopes?.SingleOrDefault(s => s.CompanyId == id)))));
    private static bool CanDelegate(GroupCompanyOption company, string code, GroupSiteSelection? target)
    {
        if (!company.Permissions.Contains(code)) return false;
        if (!ResourceAccess.IsScoped(code)) return true;
        var own = company.PermissionScopes.SingleOrDefault(x => x.Code == code);
        return own is not null && (own.AllSites || target?.AllSites == false && !target.SiteIds.Except(own.SiteIds).Any());
    }
    private static void Require(GroupCompanyOption[] choices, Guid[] ids, string[] codes, bool all, bool edit, bool assign, GroupSiteSelection[]? scopes = null)
    { if (!Allows(choices, ids, codes, all, edit, assign, scopes)) throw Denied(); }
    private static GroupSiteSelection[] SiteSelections(Guid[] companies, GroupCompanyOption[] choices, GroupSiteSelection[]? requested, State? before = null)
    {
        if (requested is not null && (requested.Length != companies.Length || requested.Any(x => x is null)
            || requested.Select(x => x.CompanyId).Distinct().Count() != requested.Length || requested.Any(x => !companies.Contains(x.CompanyId))))
            throw UserAccounts.Error(400, "invalid_site_scopes", "Minden kiválasztott céghez egyszer add meg a telephely-hozzáférést.");
        return companies.Select(id =>
        {
            var selection = requested?.Single(x => x.CompanyId == id)
                ?? before?.SiteScopes?.SingleOrDefault(x => x.CompanyId == id) ?? new(id, true, []);
            var company = choices.SingleOrDefault(x => x.Id == id) ?? throw Denied();
            if (selection.SiteIds is null || selection.SiteIds.Length > 2000 || selection.SiteIds.Contains(Guid.Empty)
                || selection.SiteIds.Distinct().Count() != selection.SiteIds.Length || selection.AllSites && selection.SiteIds.Length > 0
                || !selection.AllSites && selection.SiteIds.Length == 0)
                throw UserAccounts.Error(400, "invalid_site_scopes", "Válaszd a teljes céget vagy legalább egy különböző telephelyet.");
            foreach (var site in selection.SiteIds)
                if (!company.Sites.Any(x => x.Id == site && (!x.IsArchived || before?.SiteScopes?.Any(s => s.CompanyId == id && s.SiteIds.Contains(site)) == true)))
                    throw UserAccounts.Error(400, "invalid_site_scopes", "Csak a kiválasztott cég aktív telephelyei adhatók meg.");
            return selection with { SiteIds = selection.SiteIds.Order().ToArray() };
        }).ToArray();
    }
    private static Guid[] Companies(Guid[]? ids)
    {
        if (ids is null || ids.Length is < 1 or > 100 || ids.Contains(Guid.Empty) || ids.Distinct().Count() != ids.Length)
            throw UserAccounts.Error(400, "invalid_companies", "Válassz 1–100 különböző céget.");
        return ids.Order().ToArray();
    }
    private static string Name(string? name)
    {
        var value = name?.Trim() ?? "";
        if (value.Length is < 1 or > 80 || value.Any(char.IsControl)) throw UserAccounts.Error(400, "invalid_group_name", "A csoport neve 1–80 karakter legyen.");
        return value;
    }
    private static void Version(long actual, long expected)
    {
        if (expected < 1) throw UserAccounts.Error(400, "invalid_version", "Add meg az aktuális verziót.");
        if (actual != expected) throw UserAccounts.Error(409, "stale_group", "Az adatok időközben megváltoztak. Töltsd be újra őket.");
    }
    // Custom group names are unique for an exact company selection. The protected admin is shared.
    private async Task Unique(string name, Guid[] companies, Guid? except, CancellationToken ct)
    {
        if (await db.PermissionGroups.AnyAsync(x => x.NormalizedName == name.ToUpperInvariant() && x.Id != except
            && x.Companies.Count == companies.Length && x.Companies.All(c => companies.Contains(c.TenantId)), ct))
            throw UserAccounts.Error(409, "group_name_exists", "Ezeknél a cégeknél már létezik ilyen nevű csoport.");
    }
    private static ManagementException ProtectedAdmin() => UserAccounts.Error(409, "protected_admin_group", "Az admin közös rendszercsoport, nem módosítható és nem törölhető. A cégeket a felhasználó csoporttagságánál válaszd ki.");
    private static State Snapshot(PermissionGroup group) => new(group.Name, group.AllPermissions, group.EffectivePermissions.Order(StringComparer.Ordinal).ToArray(), group.Companies.Select(x => x.TenantId).Order().ToArray(),
        group.Companies.Select(x => new GroupSiteSelection(x.TenantId, !x.RestrictSites, x.Sites.Select(s => s.SiteId).Order().ToArray())).ToArray(), group.DashboardMode, group.DashboardPriority);
    private async Task<PermissionGroup> Group(Guid id, GroupCompanyOption[] choices, CancellationToken ct)
    {
        var visible = choices.Select(x => x.Id).ToArray();
        return await db.PermissionGroups.Include(x => x.Permissions).Include(x => x.Companies).ThenInclude(x => x.Sites).AsSplitQuery()
            .SingleOrDefaultAsync(x => x.Id == id && (x.IsAdmin || (x.Companies.Any() && x.Companies.All(c => visible.Contains(c.TenantId)))) && visible.Length > 0, ct)
            ?? throw UserAccounts.Error(404, "group_not_found", "A jogosultságcsoport nem található, vagy nem minden cégéhez férsz hozzá.");
    }
    private async Task<PermissionGroupSummary[]> List(GroupCompanyOption[] choices, CancellationToken ct)
    {
        var visible = choices.Select(x => x.Id).ToArray();
        var groups = await db.PermissionGroups.AsNoTracking().Include(x => x.Permissions).Include(x => x.Companies).ThenInclude(x => x.Sites).AsSplitQuery()
            .Where(x => visible.Length > 0 && (x.IsAdmin || (x.Companies.Any() && x.Companies.All(c => visible.Contains(c.TenantId))))).OrderBy(x => x.Name).ThenBy(x => x.Id).ToArrayAsync(ct);
        var ids = groups.Select(x => x.Id).ToArray();
        var counts = await db.GroupUsers.Where(x => ids.Contains(x.GroupId)).GroupBy(x => x.GroupId)
            .Select(x => new { Id = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        var admin = groups.SingleOrDefault(x => x.IsAdmin);
        if (admin is not null)
            counts[admin.Id] = await db.GroupUserCompanies.Where(x => x.GroupId == admin.Id && visible.Contains(x.TenantId)).Select(x => x.UserId).Distinct().CountAsync(ct);
        return groups.Select(x => Summary(x, choices, counts.GetValueOrDefault(x.Id))).ToArray();
    }
    private static PermissionGroupSummary Summary(PermissionGroup group, GroupCompanyOption[] choices, int count)
    {
        if (group.IsAdmin)
        {
            var assignable = choices.Where(x => x.CanAssign && x.CanGrantAll).ToArray();
            return new(group.Id, group.Name, group.CreatedBy, group.Version, true, true, Permissions.All,
                (assignable.Length > 0 ? assignable : choices).Select(x => new GroupCompanyTarget(x.Id, x.Name)).ToArray(), count, false, assignable.Length > 0)
                { DashboardMode = group.DashboardMode, DashboardPriority = group.DashboardPriority };
        }
        var state = Snapshot(group);
        return new(group.Id, group.Name, group.CreatedBy, group.Version, group.AllPermissions, group.IsAdmin, state.Permissions,
            state.CompanyIds.Select(id => new GroupCompanyTarget(id, choices.Single(x => x.Id == id).Name)
            {
                AllSites = state.SiteScopes!.Single(x => x.CompanyId == id).AllSites,
                Sites = choices.Single(x => x.Id == id).Sites.Where(s => state.SiteScopes!.Single(x => x.CompanyId == id).SiteIds.Contains(s.Id)).ToArray()
            }).ToArray(), count,
            Allows(choices, state.CompanyIds, state.Permissions, group.AllPermissions, edit: true, assign: count > 0, scopes: state.SiteScopes),
            Allows(choices, state.CompanyIds, state.Permissions, group.AllPermissions, edit: false, assign: true, scopes: state.SiteScopes))
        {
            DashboardMode = group.DashboardMode, DashboardPriority = group.DashboardPriority,
            CanConfigureDashboard = Allows(choices, state.CompanyIds, state.Permissions, group.AllPermissions, edit: true, assign: count > 0, scopes: state.SiteScopes)
        };
    }
    public Task<PermissionGroupSummary[]> ListAsync(string actor, CancellationToken ct) => Run(false, async () =>
    {
        var system = await UserAccounts.IsSystemManager(db, actor, ct);
        return (await List(await Choices(actor, ct), ct)).Select(group => group.IsAdmin && system ? group with { CanConfigureDashboard = true } : group).ToArray();
    }, ct);

    private async Task<HashSet<Guid>> Managers(string actor, Guid[] ids, CancellationToken ct)
    {
        var result = new HashSet<Guid>();
        foreach (var id in ids.Order())
            if (await InCompany(id, actor, async scoped =>
            {
                await AccessRules.LockTenant(scoped, id, ct);
                return (await scoped.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == id && x.IsActive).ToArrayAsync(ct))
                    .Any(x => x.HasCompanyAccess && x.EffectivePermissions.Contains(Permissions.Manage));
            }, ct)) result.Add(id);
        return result;
    }
    private async Task Sync(string actor, Guid groupId, State? before, State? after, string[] oldUsers, string[] newUsers, HashSet<Guid> protectedCompanies, string action, CancellationToken ct, string? subject = null)
    {
        var companies = (before?.CompanyIds ?? []).Concat(after?.CompanyIds ?? []).Distinct().Order().ToArray();
        foreach (var company in companies)
            await InCompany(company, actor, async scoped =>
            {
                var desired = after?.CompanyIds.Contains(company) == true ? newUsers : [];
                var rows = await scoped.MembershipGroups.Where(x => x.GroupId == groupId && (subject == null || x.UserSubject == subject)).ToArrayAsync(ct);
                var scopes = await scoped.GroupUserCompanies.Where(x => x.GroupId == groupId && x.TenantId == company && (subject == null || x.UserId == subject)).ToArrayAsync(ct);
                var affected = rows.Select(x => x.UserSubject).Concat(desired).Distinct().ToArray();
                var memberships = await scoped.Memberships.Where(x => x.TenantId == company && affected.Contains(x.UserSubject)).ToDictionaryAsync(x => x.UserSubject, ct);
                foreach (var userSubject in desired)
                {
                    if (!memberships.ContainsKey(userSubject))
                    {
                        var member = new TenantMembership { TenantId = company, UserSubject = userSubject, HasDirectAccess = false, JoinedAt = DateTimeOffset.UtcNow };
                        scoped.Memberships.Add(member); memberships.Add(userSubject, member);
                    }
                    if (!rows.Any(x => x.UserSubject == userSubject)) scoped.MembershipGroups.Add(new() { TenantId = company, UserSubject = userSubject, GroupId = groupId });
                    if (!scopes.Any(x => x.UserId == userSubject)) scoped.GroupUserCompanies.Add(new() { GroupId = groupId, UserId = userSubject, TenantId = company });
                }
                scoped.MembershipGroups.RemoveRange(rows.Where(x => !desired.Contains(x.UserSubject)));
                foreach (var member in memberships.Values) member.Version++;
                // A suspended membership is never reactivated by adding or changing a group.
                scoped.AccessAuditEvents.Add(new() { TenantId = company, ActorSubject = actor, Action = action, Details = JsonSerializer.Serialize(new
                {
                    groupId, before = before is null ? null : new { before.Name, before.AllPermissions, before.Permissions, before.DashboardMode, before.DashboardPriority, applies = before.CompanyIds.Contains(company), siteScope = before.SiteScopes?.SingleOrDefault(x => x.CompanyId == company) },
                    after = after is null ? null : new { after.Name, after.AllPermissions, after.Permissions, after.DashboardMode, after.DashboardPriority, applies = after.CompanyIds.Contains(company), siteScope = after.SiteScopes?.SingleOrDefault(x => x.CompanyId == company) }, affectedUsers = affected
                }) });
                await scoped.SaveChangesAsync(ct);
                scoped.GroupUserCompanies.RemoveRange(scopes.Where(x => !desired.Contains(x.UserId)));
                await scoped.SaveChangesAsync(ct);
                if (protectedCompanies.Contains(company))
                {
                    var current = await scoped.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == company && x.IsActive).ToArrayAsync(ct);
                    if (!current.Any(x => x.HasCompanyAccess && x.EffectivePermissions.Contains(Permissions.Manage))) throw AccessRules.LastManager();
                }
                return true;
            }, ct);
        UserAccounts.Audit(db, actor, null, action, new { groupId, before, after, previousUsers = oldUsers, users = newUsers });
        await db.SaveChangesAsync(ct);
    }
    public Task<PermissionGroupSummary> CreateAsync(string actor, CreateGroupRequest request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct);
        ValidateDashboard(request.DashboardMode, request.DashboardPriority);
        var ids = Companies(request.CompanyIds); var name = Name(request.Name); var codes = AccessRules.Validate(request.Permissions);
        var sites = SiteSelections(ids, choices, request.SiteScopes);
        if (request.AllPermissions && codes.Length > 0) throw UserAccounts.Error(400, "invalid_permissions", "Automatikus teljes jogkörnél ne adj meg külön joglistát.");
        Require(choices, ids, request.AllPermissions ? Permissions.All : codes, request.AllPermissions, edit: true, assign: false, scopes: sites);
        if (name.Equals("admin", StringComparison.OrdinalIgnoreCase)) throw ProtectedAdmin();
        await Unique(name, ids, null, ct);
        var group = new PermissionGroup { CreatedBy = actor, Name = name, NormalizedName = name.ToUpperInvariant(), AllPermissions = request.AllPermissions,
            DashboardMode = request.DashboardMode, DashboardPriority = request.DashboardPriority };
        group.Permissions = codes.Select(code => new GroupPermission { GroupId = group.Id, Code = code }).ToList();
        group.Companies = sites.Select(scope => new GroupCompany { GroupId = group.Id, TenantId = scope.CompanyId, RestrictSites = !scope.AllSites,
            Sites = scope.SiteIds.Select(site => new GroupCompanySite { GroupId = group.Id, TenantId = scope.CompanyId, SiteId = site }).ToList() }).ToList();
        db.PermissionGroups.Add(group); await db.SaveChangesAsync(ct);
        await Sync(actor, group.Id, null, Snapshot(group), [], [], [], "group.created", ct);
        return Summary(group, choices, 0);
    }, ct);

    public Task<PermissionGroupSummary> UpdateAsync(string actor, Guid id, UpdateGroupRequest request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct); var group = await Group(id, choices, ct); Version(group.Version, request.Version);
        if (group.IsAdmin) throw ProtectedAdmin();
        var mode = request.DashboardMode ?? group.DashboardMode;
        var priority = request.DashboardPriority ?? group.DashboardPriority;
        ValidateDashboard(mode, priority);
        var before = Snapshot(group); var ids = Companies(request.CompanyIds); var name = Name(request.Name); var codes = AccessRules.Validate(request.Permissions);
        var sites = SiteSelections(ids, choices, request.SiteScopes, before);
        if (request.AllPermissions && codes.Length > 0) throw UserAccounts.Error(400, "invalid_permissions", "Automatikus teljes jogkörnél ne adj meg külön joglistát.");
        var users = await db.GroupUsers.Where(x => x.GroupId == id).Select(x => x.UserId).ToArrayAsync(ct);
        Require(choices, before.CompanyIds, before.Permissions, before.AllPermissions, edit: true, assign: users.Length > 0, scopes: before.SiteScopes);
        Require(choices, ids, request.AllPermissions ? Permissions.All : codes, request.AllPermissions, edit: true, assign: users.Length > 0, scopes: sites);
        if (group.IsAdmin && (name != group.Name || !request.AllPermissions)) throw ProtectedAdmin();
        if (!group.IsAdmin && name != group.Name && name.Equals("admin", StringComparison.OrdinalIgnoreCase)) throw ProtectedAdmin();
        await Unique(name, ids, id, ct);
        var managers = await Managers(actor, before.CompanyIds.Concat(ids).Distinct().ToArray(), ct);
        foreach (var removed in group.Permissions.Where(x => !codes.Contains(x.Code)).ToArray()) { group.Permissions.Remove(removed); db.GroupPermissions.Remove(removed); }
        foreach (var code in codes.Except(group.Permissions.Select(x => x.Code))) group.Permissions.Add(new() { GroupId = id, Code = code });
        var removedScopes = group.Companies.Where(x => !ids.Contains(x.TenantId)).ToArray();
        foreach (var added in ids.Except(before.CompanyIds)) group.Companies.Add(new() { GroupId = id, TenantId = added });
        foreach (var selection in sites)
        {
            var scope = group.Companies.Single(x => x.TenantId == selection.CompanyId);
            scope.RestrictSites = !selection.AllSites;
            foreach (var old in scope.Sites.Where(x => !selection.SiteIds.Contains(x.SiteId)).ToArray())
            { scope.Sites.Remove(old); db.GroupCompanySites.Remove(old); }
            foreach (var site in selection.SiteIds.Except(scope.Sites.Select(x => x.SiteId)))
                scope.Sites.Add(new() { GroupId = id, TenantId = selection.CompanyId, SiteId = site });
        }
        group.Name = name; group.NormalizedName = name.ToUpperInvariant(); group.AllPermissions = request.AllPermissions;
        group.DashboardMode = mode; group.DashboardPriority = priority; group.Version++;
        await db.SaveChangesAsync(ct); // Insert new scope keys before materializing memberships; retain old scope FKs until removal.
        var after = new State(name, request.AllPermissions, group.EffectivePermissions.Order(StringComparer.Ordinal).ToArray(), ids, sites, mode, priority);
        await Sync(actor, id, before, after, users, users, managers, "group.updated", ct);
        foreach (var scope in removedScopes) { group.Companies.Remove(scope); db.GroupCompanies.Remove(scope); }
        await db.SaveChangesAsync(ct);
        return Summary(group, choices, users.Length);
    }, ct);
    public Task<PermissionGroupSummary> DashboardAsync(string actor, Guid id, GroupDashboardInput request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct); var group = await Group(id, choices, ct);
        Version(group.Version, request.Version); ValidateDashboard(request.Mode, request.Priority);
        var before = Snapshot(group);
        if (group.IsAdmin)
        {
            if (!await UserAccounts.IsSystemManager(db, actor, ct)) throw Denied();
        }
        else
        {
            var hasUsers = await db.GroupUsers.AnyAsync(x => x.GroupId == id, ct);
            Require(choices, before.CompanyIds, before.Permissions, before.AllPermissions, edit: true, assign: hasUsers, scopes: before.SiteScopes);
        }
        group.DashboardMode = request.Mode; group.DashboardPriority = request.Priority; group.Version++;
        UserAccounts.Audit(db, actor, null, "group.dashboard_changed", new { groupId = id, before, after = Snapshot(group) });
        foreach (var company in group.Companies.Where(c => choices.Any(x => x.Id == c.TenantId)).Select(c => c.TenantId).Order())
            await InCompany(company, actor, async scoped =>
            {
                await AccessRules.LockTenant(scoped, company, ct);
                scoped.AccessAuditEvents.Add(new() { TenantId = company, ActorSubject = actor, Action = "group.dashboard_changed",
                    Details = JsonSerializer.Serialize(new { groupId = id, before = new { before.DashboardMode, before.DashboardPriority }, after = new { request.Mode, request.Priority } }) });
                await scoped.SaveChangesAsync(ct); return true;
            }, ct);
        await db.SaveChangesAsync(ct);
        var result = (await List(choices, ct)).Single(x => x.Id == id);
        return result with { DashboardMode = request.Mode, DashboardPriority = request.Priority, CanConfigureDashboard = true };
    }, ct);

    public async Task DeleteAsync(string actor, Guid id, long version, CancellationToken ct) => _ = await Run(true, async () =>
    {
        var choices = await Choices(actor, ct); var group = await Group(id, choices, ct); Version(group.Version, version);
        if (group.IsAdmin) throw ProtectedAdmin();
        var before = Snapshot(group); var users = await db.GroupUsers.Where(x => x.GroupId == id).Select(x => x.UserId).ToArrayAsync(ct);
        Require(choices, before.CompanyIds, before.Permissions, before.AllPermissions, edit: true, assign: users.Length > 0, scopes: before.SiteScopes);
        var managers = await Managers(actor, before.CompanyIds, ct);
        await Sync(actor, id, before, null, users, [], managers, "group.deleted", ct);
        db.PermissionGroups.Remove(group); await db.SaveChangesAsync(ct); return true;
    }, ct);

    private static void AssignmentAuthority(GroupCompanyOption[] choices)
    { if (!choices.Any(x => x.CanAssign)) throw Denied(); }
    private async Task<GroupUserSummary> User(string userId, PermissionGroupSummary[] available, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == userId && !db.AccountLifecycles.Any(a => a.UserId == x.Id && a.IsArchived), ct) ?? throw UserAccounts.Error(404, "user_not_found", "A felhasználó nem található.");
        var ids = await db.GroupUsers.Where(x => x.UserId == userId).Select(x => x.GroupId).ToArrayAsync(ct);
        var admin = available.SingleOrDefault(x => x.IsAdmin);
        var manageable = available.Where(x => x.CanAssign && !x.IsAdmin).Select(x => x.Id).ToArray();
        var allowed = admin?.CanAssign == true ? admin.Companies.Select(x => x.Id).ToArray() : [];
        var adminScopes = await db.GroupUserCompanies.Where(x => x.UserId == userId && db.PermissionGroups.Any(g => g.Id == x.GroupId && g.IsAdmin)).Select(x => x.TenantId).ToArrayAsync(ct);
        var visibleAdmin = adminScopes.Intersect(allowed).Order().ToArray();
        var visibleIds = ids.Intersect(manageable).Concat(visibleAdmin.Length > 0 ? new[] { admin!.Id } : []).Order().ToArray();
        var customHidden = await db.GroupUsers.AnyAsync(x => x.UserId == userId && !manageable.Contains(x.GroupId) && db.PermissionGroups.Any(g => g.Id == x.GroupId && !g.IsAdmin), ct);
        return new(userId, user.ProfileVersion, visibleIds, customHidden || adminScopes.Except(allowed).Any()) { AdminCompanyIds = visibleAdmin };
    }
    public Task<GroupUserSummary> UserAsync(string actor, string userId, CancellationToken ct) => Run(false, async () =>
    {
        var choices = await Choices(actor, ct); AssignmentAuthority(choices);
        return await User(userId, await List(choices, ct), ct);
    }, ct);
    public Task<GroupUserSummary> AssignAsync(string actor, string userId, AssignGroupsRequest request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct); AssignmentAuthority(choices);
        if (request.GroupIds is null || request.GroupIds.Length > 100 || request.GroupIds.Distinct().Count() != request.GroupIds.Length)
            throw UserAccounts.Error(400, "invalid_groups", "Legfeljebb 100 különböző csoport adható meg.");
        var available = await List(choices, ct); var assignable = available.Where(x => x.CanAssign).Select(x => x.Id).ToArray();
        if (request.GroupIds.Except(assignable).Any()) throw Denied();
        var admin = await db.PermissionGroups.SingleAsync(x => x.IsAdmin, ct);
        var selectedAdmin = request.GroupIds.Contains(admin.Id);
        var desiredAdmin = request.AdminCompanyIds ?? [];
        if (desiredAdmin.Length > 100 || desiredAdmin.Distinct().Count() != desiredAdmin.Length || desiredAdmin.Contains(Guid.Empty)
            || selectedAdmin != (desiredAdmin.Length > 0))
            throw UserAccounts.Error(400, "invalid_admin_companies", "Admin tagságnál válassz legalább egy céget; admin tagság nélkül ne adj meg admin cégeket.");
        var allowedAdmin = choices.Where(x => x.CanAssign && x.CanGrantAll).Select(x => x.Id).ToArray();
        if (desiredAdmin.Except(allowedAdmin).Any()) throw Denied();
        var user = await accounts.LockUser(userId, ct); Version(user.ProfileVersion, request.Version);
        var current = await db.GroupUsers.Where(x => x.UserId == userId).ToArrayAsync(ct);
        var beforeAdmin = await db.GroupUserCompanies.Where(x => x.GroupId == admin.Id && x.UserId == userId).Select(x => x.TenantId).ToArrayAsync(ct);
        var afterAdmin = beforeAdmin.Except(allowedAdmin).Concat(desiredAdmin).Distinct().Order().ToArray();
        var remove = current.Where(x => x.GroupId != admin.Id && assignable.Contains(x.GroupId) && !request.GroupIds.Contains(x.GroupId)).ToArray();
        var add = request.GroupIds.Where(x => x != admin.Id).Except(current.Select(x => x.GroupId)).ToArray();
        var total = current.Count(x => x.GroupId != admin.Id) - remove.Length + add.Length + (afterAdmin.Length > 0 ? 1 : 0);
        if (total > 100 && total > current.Length) throw UserAccounts.Error(400, "too_many_groups", "Egy felhasználó legfeljebb 100 jogosultságcsoport tagja lehet.");
        var changedIds = remove.Select(x => x.GroupId).Concat(add).Order().ToArray();
        var changed = new List<(PermissionGroup Group, string[] BeforeUsers)>();
        foreach (var id in changedIds) changed.Add((await Group(id, choices, ct), await db.GroupUsers.Where(x => x.GroupId == id).Select(x => x.UserId).ToArrayAsync(ct)));
        var adminChanged = !beforeAdmin.Order().SequenceEqual(afterAdmin);
        var touchedAdmin = adminChanged ? beforeAdmin.Except(afterAdmin).Concat(afterAdmin.Except(beforeAdmin)).ToArray() : [];
        var managers = await Managers(actor, changed.SelectMany(x => x.Group.Companies.Select(c => c.TenantId)).Concat(touchedAdmin).Distinct().ToArray(), ct);
        foreach (var id in add) db.GroupUsers.Add(new() { GroupId = id, UserId = userId });
        if (afterAdmin.Length > 0 && !current.Any(x => x.GroupId == admin.Id)) db.GroupUsers.Add(new() { GroupId = admin.Id, UserId = userId });
        user.ProfileVersion++; await db.SaveChangesAsync(ct);
        foreach (var (group, beforeUsers) in changed)
        {
            var afterUsers = add.Contains(group.Id) ? beforeUsers.Append(userId).ToArray() : beforeUsers.Where(x => x != userId).ToArray();
            await Sync(actor, group.Id, Snapshot(group), Snapshot(group), beforeUsers, afterUsers, [], "group.members_changed", ct);
        }
        if (adminChanged)
        {
            var before = new State(admin.Name, true, Permissions.All, touchedAdmin.Intersect(beforeAdmin).ToArray());
            var after = new State(admin.Name, true, Permissions.All, touchedAdmin.Intersect(afterAdmin).ToArray());
            await Sync(actor, admin.Id, before, after, [userId], [userId], [], "group.admin_companies_changed", ct, subject: userId);
        }
        db.GroupUsers.RemoveRange(remove);
        if (afterAdmin.Length == 0) db.GroupUsers.RemoveRange(current.Where(x => x.GroupId == admin.Id));
        await db.SaveChangesAsync(ct);
        // Validate the final combined effect, including custom-group/admin scope swaps.
        foreach (var company in managers)
            await InCompany(company, actor, async scoped =>
            {
                var members = await scoped.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == company && x.IsActive).ToArrayAsync(ct);
                if (!members.Any(x => x.HasCompanyAccess && x.EffectivePermissions.Contains(Permissions.Manage))) throw AccessRules.LastManager();
                return true;
            }, ct);
        UserAccounts.Audit(db, actor, userId, "user.groups_changed", new
        {
            before = current.Select(x => x.GroupId).ToArray(),
            after = current.Select(x => x.GroupId).Except(remove.Select(x => x.GroupId)).Where(x => x != admin.Id).Concat(add).Concat(afterAdmin.Length > 0 ? new[] { admin.Id } : []).Order().ToArray(),
            previousAdminCompanyIds = beforeAdmin, adminCompanyIds = afterAdmin, version = user.ProfileVersion
        });
        await db.SaveChangesAsync(ct);
        return await User(userId, available, ct);
    }, ct);
}
