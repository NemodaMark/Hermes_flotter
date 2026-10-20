using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hermes.Infrastructure;

public sealed class CompanyAccessGroups(HermesDbContext db, UserAccounts accounts) : ICompanyAccessGroups
{
    private sealed record State(string Name, bool AllPermissions, string[] Permissions, Guid[] CompanyIds);
    private static ManagementException Denied() => UserAccounts.Error(403, "company_group_permission_denied", "Minden érintett cégnél rendelkezned kell a művelethez és a kiosztandó jogokhoz szükséges hozzáféréssel.");
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
    private async Task<CompanyAccessOption[]> Choices(string actor, CancellationToken ct)
    {
        if (await UserAccounts.IsSystemManager(db, actor, ct))
            return (await db.Tenants.AsNoTracking().OrderBy(x => x.Name).ToArrayAsync(ct)).Select(x => new CompanyAccessOption(x.Id, x.Name, Permissions.All, true, true, true)).ToArray();
        var candidates = await db.Memberships.AsNoTracking().Where(x => x.UserSubject == actor && x.IsActive)
            .Join(db.Tenants, x => x.TenantId, x => x.Id, (m, t) => new { t.Id, t.Name }).OrderBy(x => x.Name).ToArrayAsync(ct);
        var choices = new List<CompanyAccessOption>();
        foreach (var candidate in candidates)
        {
            var member = await InCompany(candidate.Id, actor, scoped => scoped.Memberships.AsNoTracking().WithAccess()
                .SingleAsync(x => x.TenantId == candidate.Id && x.UserSubject == actor, ct), ct);
            var codes = member.EffectivePermissions;
            if (member.HasCompanyAccess && codes.Intersect([Permissions.GroupsManage, Permissions.Manage, Permissions.MembersRead]).Any())
                choices.Add(new(candidate.Id, candidate.Name, codes, codes.Contains(Permissions.GroupsManage), codes.Contains(Permissions.Manage), member.HasAdminAuthority));
        }
        return choices.ToArray();
    }
    public Task<CompanyAccessOption[]> CompaniesAsync(string actor, CancellationToken ct) => Run(false, () => Choices(actor, ct), ct);
    private static bool Allows(CompanyAccessOption[] choices, Guid[] ids, string[] codes, bool all, bool edit, bool assign)
        => ids.Length > 0 && ids.All(id => choices.Any(x => x.Id == id && (!edit || x.CanEdit) && (!assign || x.CanAssign)
            && (!all || x.CanGrantAll) && !codes.Except(x.Permissions).Any()));
    private static void Require(CompanyAccessOption[] choices, Guid[] ids, string[] codes, bool all, bool edit, bool assign)
    { if (!Allows(choices, ids, codes, all, edit, assign)) throw Denied(); }
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
        if (actual != expected) throw UserAccounts.Error(409, "stale_company_group", "Az adatok időközben megváltoztak. Töltsd be újra őket.");
    }
    private async Task Unique(string creator, string name, Guid? except, CancellationToken ct)
    {
        if (await db.CompanyAccessGroups.AnyAsync(x => x.CreatedBy == creator && x.NormalizedName == name.ToUpperInvariant() && x.Id != except, ct))
            throw UserAccounts.Error(409, "group_name_exists", "Ezzel a létrehozóval már létezik ilyen nevű többcéges csoport.");
    }
    private static State Snapshot(CompanyAccessGroup group) => new(group.Name, group.AllPermissions, group.EffectivePermissions.Order(StringComparer.Ordinal).ToArray(), group.Companies.Select(x => x.TenantId).Order().ToArray());
    private async Task<CompanyAccessGroup> Group(Guid id, CompanyAccessOption[] choices, CancellationToken ct)
    {
        var visible = choices.Select(x => x.Id).ToArray();
        return await db.CompanyAccessGroups.Include(x => x.Permissions).Include(x => x.Companies).AsSplitQuery()
            .SingleOrDefaultAsync(x => x.Id == id && x.Companies.Any() && x.Companies.All(c => visible.Contains(c.TenantId)), ct)
            ?? throw UserAccounts.Error(404, "company_group_not_found", "A többcéges csoport nem található, vagy nem minden cégéhez férsz hozzá.");
    }
    private async Task<CompanyAccessGroupSummary[]> List(CompanyAccessOption[] choices, CancellationToken ct)
    {
        var visible = choices.Select(x => x.Id).ToArray();
        var groups = await db.CompanyAccessGroups.AsNoTracking().Include(x => x.Permissions).Include(x => x.Companies).AsSplitQuery()
            .Where(x => x.Companies.Any() && x.Companies.All(c => visible.Contains(c.TenantId))).OrderBy(x => x.Name).ThenBy(x => x.Id).ToArrayAsync(ct);
        var ids = groups.Select(x => x.Id).ToArray();
        var counts = await db.CompanyAccessUsers.Where(x => ids.Contains(x.GroupId)).GroupBy(x => x.GroupId)
            .Select(x => new { Id = x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        return groups.Select(x => Summary(x, choices, counts.GetValueOrDefault(x.Id))).ToArray();
    }
    private static CompanyAccessGroupSummary Summary(CompanyAccessGroup group, CompanyAccessOption[] choices, int count)
    {
        var state = Snapshot(group);
        return new(group.Id, group.Name, group.CreatedBy, group.Version, group.AllPermissions, state.Permissions,
            state.CompanyIds.Select(id => new CompanyAccessTarget(id, choices.Single(x => x.Id == id).Name)).ToArray(), count,
            Allows(choices, state.CompanyIds, state.Permissions, group.AllPermissions, edit: true, assign: count > 0),
            Allows(choices, state.CompanyIds, state.Permissions, group.AllPermissions, edit: false, assign: true));
    }
    public Task<CompanyAccessGroupSummary[]> ListAsync(string actor, CancellationToken ct) => Run(false, async () => await List(await Choices(actor, ct), ct), ct);

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
    private async Task Sync(string actor, Guid groupId, State? before, State? after, string[] oldUsers, string[] newUsers, HashSet<Guid> protectedCompanies, string action, CancellationToken ct)
    {
        var companies = (before?.CompanyIds ?? []).Concat(after?.CompanyIds ?? []).Distinct().Order().ToArray();
        foreach (var company in companies)
            await InCompany(company, actor, async scoped =>
            {
                var desired = after?.CompanyIds.Contains(company) == true ? newUsers : [];
                var rows = await scoped.CompanyAccessMemberships.Where(x => x.GroupId == groupId).ToArrayAsync(ct);
                var affected = rows.Select(x => x.UserSubject).Concat(desired).Distinct().ToArray();
                var memberships = await scoped.Memberships.Where(x => x.TenantId == company && affected.Contains(x.UserSubject)).ToDictionaryAsync(x => x.UserSubject, ct);
                foreach (var subject in desired)
                {
                    if (!memberships.ContainsKey(subject))
                    {
                        var member = new TenantMembership { TenantId = company, UserSubject = subject, HasDirectAccess = false, JoinedAt = DateTimeOffset.UtcNow };
                        scoped.Memberships.Add(member); memberships.Add(subject, member);
                    }
                    if (!rows.Any(x => x.UserSubject == subject)) scoped.CompanyAccessMemberships.Add(new() { TenantId = company, UserSubject = subject, GroupId = groupId });
                }
                scoped.CompanyAccessMemberships.RemoveRange(rows.Where(x => !desired.Contains(x.UserSubject)));
                foreach (var member in memberships.Values) member.Version++;
                // A suspended membership is never reactivated by adding or changing a group.
                scoped.AccessAuditEvents.Add(new() { TenantId = company, ActorSubject = actor, Action = action, Details = JsonSerializer.Serialize(new
                {
                    groupId, before = before is null ? null : new { before.Name, before.AllPermissions, before.Permissions, applies = before.CompanyIds.Contains(company) },
                    after = after is null ? null : new { after.Name, after.AllPermissions, after.Permissions, applies = after.CompanyIds.Contains(company) }, affectedUsers = affected
                }) });
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
    public Task<CompanyAccessGroupSummary> CreateAsync(string actor, CreateCompanyAccessGroupRequest request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct);
        var ids = Companies(request.CompanyIds); var name = Name(request.Name); var codes = AccessRules.Validate(request.Permissions);
        if (request.AllPermissions && codes.Length > 0) throw UserAccounts.Error(400, "invalid_permissions", "Automatikus teljes jogkörnél ne adj meg külön joglistát.");
        Require(choices, ids, request.AllPermissions ? Permissions.All : codes, request.AllPermissions, edit: true, assign: false);
        await Unique(actor, name, null, ct);
        var group = new CompanyAccessGroup { CreatedBy = actor, Name = name, NormalizedName = name.ToUpperInvariant(), AllPermissions = request.AllPermissions };
        group.Permissions = codes.Select(code => new CompanyAccessPermission { GroupId = group.Id, Code = code }).ToList();
        group.Companies = ids.Select(id => new CompanyAccessScope { GroupId = group.Id, TenantId = id }).ToList();
        db.CompanyAccessGroups.Add(group); await db.SaveChangesAsync(ct);
        await Sync(actor, group.Id, null, Snapshot(group), [], [], [], "company_group.created", ct);
        return Summary(group, choices, 0);
    }, ct);

    public Task<CompanyAccessGroupSummary> UpdateAsync(string actor, Guid id, UpdateCompanyAccessGroupRequest request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct); var group = await Group(id, choices, ct); Version(group.Version, request.Version);
        var before = Snapshot(group); var ids = Companies(request.CompanyIds); var name = Name(request.Name); var codes = AccessRules.Validate(request.Permissions);
        if (request.AllPermissions && codes.Length > 0) throw UserAccounts.Error(400, "invalid_permissions", "Automatikus teljes jogkörnél ne adj meg külön joglistát.");
        var users = await db.CompanyAccessUsers.Where(x => x.GroupId == id).Select(x => x.UserId).ToArrayAsync(ct);
        Require(choices, before.CompanyIds, before.Permissions, before.AllPermissions, edit: true, assign: users.Length > 0);
        Require(choices, ids, request.AllPermissions ? Permissions.All : codes, request.AllPermissions, edit: true, assign: users.Length > 0);
        await Unique(group.CreatedBy, name, id, ct);
        var managers = await Managers(actor, before.CompanyIds.Concat(ids).Distinct().ToArray(), ct);
        foreach (var removed in group.Permissions.Where(x => !codes.Contains(x.Code)).ToArray()) { group.Permissions.Remove(removed); db.CompanyAccessPermissions.Remove(removed); }
        foreach (var code in codes.Except(group.Permissions.Select(x => x.Code))) group.Permissions.Add(new() { GroupId = id, Code = code });
        var removedScopes = group.Companies.Where(x => !ids.Contains(x.TenantId)).ToArray();
        foreach (var added in ids.Except(before.CompanyIds)) group.Companies.Add(new() { GroupId = id, TenantId = added });
        group.Name = name; group.NormalizedName = name.ToUpperInvariant(); group.AllPermissions = request.AllPermissions; group.Version++;
        await db.SaveChangesAsync(ct); // Insert new scope keys before materializing memberships; retain old scope FKs until removal.
        var after = new State(name, request.AllPermissions, group.EffectivePermissions.Order(StringComparer.Ordinal).ToArray(), ids);
        await Sync(actor, id, before, after, users, users, managers, "company_group.updated", ct);
        foreach (var scope in removedScopes) { group.Companies.Remove(scope); db.CompanyAccessScopes.Remove(scope); }
        await db.SaveChangesAsync(ct);
        return Summary(group, choices, users.Length);
    }, ct);
    public async Task DeleteAsync(string actor, Guid id, long version, CancellationToken ct) => _ = await Run(true, async () =>
    {
        var choices = await Choices(actor, ct); var group = await Group(id, choices, ct); Version(group.Version, version);
        var before = Snapshot(group); var users = await db.CompanyAccessUsers.Where(x => x.GroupId == id).Select(x => x.UserId).ToArrayAsync(ct);
        Require(choices, before.CompanyIds, before.Permissions, before.AllPermissions, edit: true, assign: users.Length > 0);
        var managers = await Managers(actor, before.CompanyIds, ct);
        await Sync(actor, id, before, null, users, [], managers, "company_group.deleted", ct);
        db.CompanyAccessGroups.Remove(group); await db.SaveChangesAsync(ct); return true;
    }, ct);

    private static void AssignmentAuthority(CompanyAccessOption[] choices)
    { if (!choices.Any(x => x.CanAssign)) throw Denied(); }
    private async Task<CompanyAccessUserSummary> User(string userId, CompanyAccessGroupSummary[] available, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == userId, ct) ?? throw UserAccounts.Error(404, "user_not_found", "A felhasználó nem található.");
        var ids = await db.CompanyAccessUsers.Where(x => x.UserId == userId).Select(x => x.GroupId).ToArrayAsync(ct);
        var manageable = available.Where(x => x.CanAssign).Select(x => x.Id).ToArray();
        return new(userId, user.ProfileVersion, ids.Intersect(manageable).Order().ToArray(), ids.Except(manageable).Any());
    }
    public Task<CompanyAccessUserSummary> UserAsync(string actor, string userId, CancellationToken ct) => Run(false, async () =>
    {
        var choices = await Choices(actor, ct); AssignmentAuthority(choices);
        return await User(userId, await List(choices, ct), ct);
    }, ct);
    public Task<CompanyAccessUserSummary> AssignAsync(string actor, string userId, AssignCompanyAccessGroupsRequest request, CancellationToken ct) => Run(true, async () =>
    {
        var choices = await Choices(actor, ct); AssignmentAuthority(choices);
        if (request.GroupIds is null || request.GroupIds.Length > 100 || request.GroupIds.Distinct().Count() != request.GroupIds.Length)
            throw UserAccounts.Error(400, "invalid_groups", "Legfeljebb 100 különböző csoport adható meg.");
        var available = await List(choices, ct); var assignable = available.Where(x => x.CanAssign).Select(x => x.Id).ToArray();
        if (request.GroupIds.Except(assignable).Any()) throw Denied();
        var user = await accounts.LockUser(userId, ct); Version(user.ProfileVersion, request.Version);
        var current = await db.CompanyAccessUsers.Where(x => x.UserId == userId).ToArrayAsync(ct);
        var remove = current.Where(x => assignable.Contains(x.GroupId) && !request.GroupIds.Contains(x.GroupId)).ToArray();
        var add = request.GroupIds.Except(current.Select(x => x.GroupId)).ToArray();
        if (current.Length - remove.Length + add.Length > 100) throw UserAccounts.Error(400, "too_many_groups", "Egy felhasználó legfeljebb 100 többcéges csoport tagja lehet.");
        var changedIds = remove.Select(x => x.GroupId).Concat(add).Order().ToArray();
        var changed = new List<(CompanyAccessGroup Group, string[] BeforeUsers)>();
        foreach (var id in changedIds) changed.Add((await Group(id, choices, ct), await db.CompanyAccessUsers.Where(x => x.GroupId == id).Select(x => x.UserId).ToArrayAsync(ct)));
        var managers = await Managers(actor, changed.SelectMany(x => x.Group.Companies.Select(c => c.TenantId)).Distinct().ToArray(), ct);
        foreach (var id in add) db.CompanyAccessUsers.Add(new() { GroupId = id, UserId = userId });
        user.ProfileVersion++; await db.SaveChangesAsync(ct);
        foreach (var (group, beforeUsers) in changed)
        {
            var afterUsers = add.Contains(group.Id) ? beforeUsers.Append(userId).ToArray() : beforeUsers.Where(x => x != userId).ToArray();
            await Sync(actor, group.Id, Snapshot(group), Snapshot(group), beforeUsers, afterUsers, [], "company_group.members_changed", ct);
        }
        db.CompanyAccessUsers.RemoveRange(remove); await db.SaveChangesAsync(ct);
        // Validate after all changed groups: replacing one manager bundle with another must be atomic.
        foreach (var company in managers)
            await InCompany(company, actor, async scoped =>
            {
                var members = await scoped.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == company && x.IsActive).ToArrayAsync(ct);
                if (!members.Any(x => x.HasCompanyAccess && x.EffectivePermissions.Contains(Permissions.Manage))) throw AccessRules.LastManager();
                return true;
            }, ct);
        UserAccounts.Audit(db, actor, userId, "user.company_groups_changed", new { before = current.Select(x => x.GroupId).ToArray(), after = current.Select(x => x.GroupId).Except(remove.Select(x => x.GroupId)).Concat(add).Order().ToArray(), version = user.ProfileVersion });
        await db.SaveChangesAsync(ct);
        return await User(userId, available, ct);
    }, ct);
}
