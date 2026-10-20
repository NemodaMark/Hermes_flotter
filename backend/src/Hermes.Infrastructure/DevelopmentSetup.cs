using System.Net;
using Hermes.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Hermes.Infrastructure;

public sealed record DevelopmentCleanup(string[] ArchiveUserIds, Guid[] ArchiveTenantIds, string[]? RetireSubjects = null);
public sealed record DevelopmentSetupResult(string AdminUserId, int ArchivedUsers, int ArchivedCompanies, int FormerAdministrators);

public static class DevelopmentSetup
{
    public static void Validate(bool development, string connection)
    {
        var host = new NpgsqlConnectionStringBuilder(connection).Host;
        if (!development || !(host == "localhost" || IPAddress.TryParse(host, out var ip) && IPAddress.IsLoopback(ip)))
            throw new InvalidOperationException("Development account setup requires Development and a local database.");
    }

    // Explicit operator command only. Ordinary registration/password validation is unchanged.
    public static async Task<DevelopmentSetupResult> Run(HermesDbContext db, bool development, string password, DevelopmentCleanup cleanup, CancellationToken ct)
    {
        Validate(development, db.Database.GetConnectionString()!);
        if (string.IsNullOrEmpty(password) || password.Length > 128 || cleanup.ArchiveUserIds.Contains("admin"))
            throw new InvalidOperationException("Specify a development password and a cleanup manifest excluding admin.");
        const string actor = "operator:development-setup";
        var archiveUsers = cleanup.ArchiveUserIds.Distinct().ToArray();
        var archiveCompanies = cleanup.ArchiveTenantIds.Distinct().ToArray();
        var retired = archiveUsers.Concat(cleanup.RetireSubjects ?? []).Distinct().ToArray();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await UserAccounts.LockSystemAccess(db, ct);
        var companies = await db.Tenants.IgnoreQueryFilters().AsNoTracking().ToArrayAsync(ct);
        if (archiveCompanies.Except(companies.Select(x => x.Id)).Any()
            || await db.Users.CountAsync(x => archiveUsers.Contains(x.Id), ct) != archiveUsers.Length)
            throw new InvalidOperationException("The cleanup manifest refers to unknown accounts or companies.");
        var formerAdmins = await db.SystemPermissionGrants.Where(x => x.Code == SystemPermissions.Manage && x.UserId != "admin").Select(x => x.UserId)
            .Union(db.GroupUsers.Where(x => x.UserId != "admin" && db.PermissionGroups.Any(g => g.Id == x.GroupId && g.AllPermissions)).Select(x => x.UserId)).ToArrayAsync(ct);
        var admin = await db.Users.SingleOrDefaultAsync(x => x.Id == "admin", ct);
        if (admin is null)
        {
            admin = new ApplicationUser { Id = "admin", UserName = "admin", NormalizedUserName = "ADMIN", Email = "admin@hermes.local", NormalizedEmail = "ADMIN@HERMES.LOCAL", DisplayName = "Rendszergazda" };
            db.Users.Add(admin);
            await db.SaveChangesAsync(ct);
            db.UserIdentityHistory.Add(new() { PreviousId = "admin", UserId = "admin" });
        }
        admin.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(admin, password);
        admin.SecurityStamp = Guid.NewGuid().ToString(); admin.ConcurrencyStamp = Guid.NewGuid().ToString();
        admin.PasswordChangeRequired = false; admin.PasswordChangeRequestedAt = null; admin.LockoutEnabled = true;
        admin.LockoutEnd = null; admin.AccessFailedCount = 0; admin.ProfileVersion++;
        var adminState = await db.AccountLifecycles.SingleOrDefaultAsync(x => x.UserId == "admin", ct);
        if (adminState is null) { adminState = new() { UserId = "admin" }; db.AccountLifecycles.Add(adminState); }
        adminState.IsArchived = false; adminState.DevelopmentOnly = true; adminState.ArchivedAt = null;
        db.SystemPermissionGrants.RemoveRange(await db.SystemPermissionGrants.Where(x => x.Code == SystemPermissions.Manage && x.UserId != "admin").ToArrayAsync(ct));
        if (!await db.SystemPermissionGrants.AnyAsync(x => x.UserId == "admin" && x.Code == SystemPermissions.Manage, ct))
            db.SystemPermissionGrants.Add(new() { UserId = "admin", Code = SystemPermissions.Manage });
        var group = await db.PermissionGroups.SingleAsync(x => x.IsAdmin, ct);
        if (!await db.GroupUsers.AnyAsync(x => x.GroupId == group.Id && x.UserId == "admin", ct)) db.GroupUsers.Add(new() { GroupId = group.Id, UserId = "admin" });
        await db.SaveChangesAsync(ct);
        foreach (var company in companies.OrderBy(x => x.Id))
        {
            var archived = archiveCompanies.Contains(company.Id) || await db.ArchivedTenants.AnyAsync(x => x.TenantId == company.Id, ct);
            if (archived && !await db.ArchivedTenants.AnyAsync(x => x.TenantId == company.Id, ct))
                db.ArchivedTenants.Add(new() { TenantId = company.Id, Reason = "Approved local test data cleanup" });
            var context = new TenantContext(); context.Set(company.Id, actor, []);
            var options = new DbContextOptionsBuilder<HermesDbContext>().UseNpgsql(db.Database.GetDbConnection()).Options;
            await using var scoped = new HermesDbContext(options, context);
            await scoped.Database.UseTransactionAsync(tx.GetDbTransaction(), ct);
            await scoped.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {company.Id.ToString()}, true)", ct);
            var members = await scoped.Memberships.WithAccess().Where(x => x.TenantId == company.Id).ToArrayAsync(ct);
            var removed = await scoped.MembershipGroups.Include(x => x.Group).Where(x => x.TenantId == company.Id
                && (archived || retired.Contains(x.UserSubject) || x.UserSubject != "admin" && x.Group.AllPermissions)).ToArrayAsync(ct);
            scoped.MembershipGroups.RemoveRange(removed);
            foreach (var member in members)
            {
                if (archived || retired.Contains(member.UserSubject)) { member.IsActive = false; member.HasDirectAccess = false; member.DisabledAt ??= DateTimeOffset.UtcNow; }
                if (archived || retired.Contains(member.UserSubject) || removed.Any(x => x.UserSubject == member.UserSubject)) member.Version++;
            }
            await scoped.SaveChangesAsync(ct);
            scoped.GroupUserCompanies.RemoveRange(await scoped.GroupUserCompanies.Where(x => x.TenantId == company.Id
                && (archived || retired.Contains(x.UserId) || x.UserId != "admin" && scoped.PermissionGroups.Any(g => g.Id == x.GroupId && g.AllPermissions))).ToArrayAsync(ct));
            await scoped.SaveChangesAsync(ct);
            if (!archived)
            {
                if (!await scoped.GroupCompanies.AnyAsync(x => x.GroupId == group.Id && x.TenantId == company.Id, ct)) scoped.GroupCompanies.Add(new() { GroupId = group.Id, TenantId = company.Id });
                var member = members.SingleOrDefault(x => x.UserSubject == "admin");
                if (member is null) { member = new() { TenantId = company.Id, UserSubject = "admin", HasDirectAccess = false, JoinedAt = DateTimeOffset.UtcNow }; scoped.Memberships.Add(member); }
                member.IsActive = true; member.DisabledAt = null; member.Version++;
                if (!await scoped.GroupUserCompanies.AnyAsync(x => x.GroupId == group.Id && x.UserId == "admin" && x.TenantId == company.Id, ct)) scoped.GroupUserCompanies.Add(new() { GroupId = group.Id, UserId = "admin", TenantId = company.Id });
                if (!await scoped.MembershipGroups.AnyAsync(x => x.GroupId == group.Id && x.UserSubject == "admin", ct)) scoped.MembershipGroups.Add(new() { GroupId = group.Id, UserSubject = "admin", TenantId = company.Id });
            }
            scoped.AccessAuditEvents.Add(new() { TenantId = company.Id, ActorSubject = actor, Action = "development.access_reset", Details = System.Text.Json.JsonSerializer.Serialize(new { archived, retiredUsers = members.Where(x => retired.Contains(x.UserSubject)).Select(x => x.UserSubject).ToArray(), adminAssigned = !archived }) });
            await scoped.SaveChangesAsync(ct);
        }
        db.GroupUsers.RemoveRange(await db.GroupUsers.Where(x => retired.Contains(x.UserId) || x.UserId != "admin" && db.PermissionGroups.Any(g => g.Id == x.GroupId && g.AllPermissions)).ToArrayAsync(ct));
        db.GroupCompanies.RemoveRange(await db.GroupCompanies.Where(x => archiveCompanies.Contains(x.TenantId)).ToArrayAsync(ct));
        await db.SaveChangesAsync(ct);
        db.PermissionGroups.RemoveRange(await db.PermissionGroups.Where(x => !x.IsAdmin && !x.Companies.Any()).ToArrayAsync(ct));
        foreach (var user in await db.Users.Where(x => x.Id != "admin" && (archiveUsers.Contains(x.Id) || formerAdmins.Contains(x.Id))).ToArrayAsync(ct))
        {
            user.ProfileVersion++; user.SecurityStamp = Guid.NewGuid().ToString(); user.ConcurrencyStamp = Guid.NewGuid().ToString();
            if (archiveUsers.Contains(user.Id))
            {
                var state = await db.AccountLifecycles.SingleOrDefaultAsync(x => x.UserId == user.Id, ct);
                if (state is null) { state = new() { UserId = user.Id }; db.AccountLifecycles.Add(state); }
                state.IsArchived = true; state.ArchivedAt ??= DateTimeOffset.UtcNow; state.Reason = "Approved local test data cleanup";
                user.LockoutEnabled = true; user.LockoutEnd = DateTimeOffset.UtcNow.AddYears(100);
            }
            UserAccounts.Audit(db, actor, user.Id, archiveUsers.Contains(user.Id) ? "user.test_account_archived" : "user.admin_access_revoked", new { version = user.ProfileVersion });
        }
        UserAccounts.Audit(db, actor, "admin", "development.admin_configured", new { archiveUsers, archiveCompanies, formerAdmins });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new("admin", archiveUsers.Length, archiveCompanies.Length, formerAdmins.Length);
    }
}
