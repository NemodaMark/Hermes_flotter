using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hermes.Infrastructure;

public sealed class SystemUserDirectory(HermesDbContext db, UserAccounts accounts)
{
    public async Task<PageResult<UserProfile>> List(string actor, int page, string? search, string? role, string? access, CancellationToken ct)
    {
        if (page is < 1 or > 10000 || search?.Length > 100)
            throw UserAccounts.Error(400, "invalid_search", "Érvénytelen oldalszám vagy keresés.");
        if (role is not (null or "all" or "admin" or "member") || access is not (null or "all" or "with" or "none"))
            throw UserAccounts.Error(400, "invalid_filter", "Ismeretlen felhasználószűrő.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        if (!await UserAccounts.IsSystemManager(db, actor, ct)) throw UserAccounts.Error(403, "system_permission_required", "Rendszerszintű kezelési jog szükséges.");
        var companies = await db.Tenants.AsNoTracking().OrderBy(x => x.Name).ToArrayAsync(ct);
        var members = new List<TenantMembership>();
        foreach (var company in companies)
        {
            var context = new TenantContext(); context.Set(company.Id, actor, []);
            var options = new DbContextOptionsBuilder<HermesDbContext>().UseNpgsql(db.Database.GetDbConnection()).Options;
            await using var scoped = new HermesDbContext(options, context);
            await scoped.Database.UseTransactionAsync(tx.GetDbTransaction(), ct);
            await scoped.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {company.Id.ToString()}, true)", ct);
            members.AddRange(await scoped.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == company.Id).ToArrayAsync(ct));
        }
        var managers = await db.SystemPermissionGrants.Where(x => x.Code == SystemPermissions.Manage).Select(x => x.UserId).ToArrayAsync(ct);
        var admins = members.Where(x => x.HasCompanyAccess && x.HasAdminAuthority).Select(x => x.UserSubject).Concat(managers).Distinct().ToArray();
        var accessible = members.Where(x => x.HasCompanyAccess).Select(x => x.UserSubject).Concat(companies.Length > 0 ? managers : []).Distinct().ToArray();
        var query = db.Users.AsNoTracking().Where(x => !db.AccountLifecycles.Any(a => a.UserId == x.Id && a.IsArchived));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var text = search.Trim().ToUpperInvariant();
            // PostgreSQL 18's built-in Unicode collation also folds accented Hungarian names on C-locale databases.
            query = query.Where(x => x.NormalizedUserName!.Contains(text) || x.NormalizedEmail!.Contains(text)
                || EF.Functions.Collate(x.DisplayName, "unicode").ToUpper().Contains(text));
        }
        if (role == "admin") query = query.Where(x => admins.Contains(x.Id));
        if (role == "member") query = query.Where(x => !admins.Contains(x.Id));
        if (access == "with") query = query.Where(x => accessible.Contains(x.Id));
        if (access == "none") query = query.Where(x => !accessible.Contains(x.Id));
        var total = await query.CountAsync(ct);
        var users = await query.OrderBy(x => x.Id).Skip((page - 1) * 25).Take(25).ToArrayAsync(ct);
        var userIds = users.Select(user => user.Id).ToArray();
        var backgrounds = await db.UserCardBackgrounds.Where(x => userIds.Contains(x.UserId))
            .Select(x => new { x.UserId, x.Sha256 }).ToDictionaryAsync(x => x.UserId, x => x.Sha256, ct);
        var result = new List<UserProfile>();
        foreach (var user in users)
        {
            var global = managers.Contains(user.Id);
            var own = members.Where(x => x.UserSubject == user.Id).ToArray();
            var rights = companies.Select(company =>
            {
                var member = own.SingleOrDefault(x => x.TenantId == company.Id);
                return new UserCompanyAccess(company.Id, company.Name, global || member?.HasCompanyAccess == true,
                    global || (member?.HasCompanyAccess == true && member.HasAdminAuthority), member?.IsActive == false);
            }).Where(x => x.HasAccess || x.IsSuspended).ToArray();
            result.Add((await accounts.Profile(user, ct)) with
            { IsAdministrator = admins.Contains(user.Id), CompanyAccess = rights, CardBackgroundRevision = backgrounds.GetValueOrDefault(user.Id) });
        }
        await tx.CommitAsync(ct);
        return new(result.ToArray(), total, page, 25);
    }
}
