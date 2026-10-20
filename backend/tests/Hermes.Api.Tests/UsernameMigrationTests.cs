using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class UsernameMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Upgrade_rewrites_all_live_references_preserves_original_audits_and_expires_old_cookies()
    {
        var database = $"hermes_username_upgrade_{Guid.NewGuid():N}";
        var migrator = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection) { Database = database };
        var runtime = new NpgsqlConnectionStringBuilder(fixture.ApplicationConnection) { Database = database };
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{migrator.Username}\"");
        try
        {
            await FleetFixture.ExecuteAsync(migrator.ConnectionString, $"""
                REVOKE CREATE ON SCHEMA public FROM PUBLIC;
                GRANT USAGE ON SCHEMA public TO "{runtime.Username}";
                ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{runtime.Username}";
                """);
            await using (var oldDb = FleetFixture.CreateContext(migrator.ConnectionString, new TenantContext()))
                await oldDb.GetService<IMigrator>().MigrateAsync("20261020072656_UserProfilesAndSystemAccess");
            await using var factory = fixture.CreateFactory().WithWebHostBuilder(builder => builder.UseSetting("ConnectionStrings:Database", runtime.ConnectionString));
            var firstId = "00000000-0000-4000-8000-000000000001";
            var secondId = "00000000-0000-4000-8000-000000000002";
            var longId = "00000000-0000-4000-8000-000000000003";
            string passwordHash;
            string securityStamp;
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
                foreach (var user in new[] {
                    new ApplicationUser { Id = firstId, UserName = "shared@one.example.test", Email = "shared@one.example.test", DisplayName = "Meglévő Kezelő" },
                    new ApplicationUser { Id = secondId, UserName = "shared@two.example.test", Email = "shared@two.example.test", DisplayName = "Másik Személy", PasswordChangeRequired = true },
                    new ApplicationUser { Id = longId, UserName = "old-long-name", Email = new string('a', 90) + "@example.test", DisplayName = "Hosszú Azonosító" } })
                    Assert.True((await users.CreateAsync(user, FleetFixture.Password)).Succeeded);
                var first = (await users.FindByIdAsync(firstId))!;
                Assert.True((await users.AddClaimAsync(first, new Claim("custom", "retained"))).Succeeded);
                Assert.True((await users.AddLoginAsync(first, new UserLoginInfo("test-provider", "external-key", "Provider"))).Succeeded);
                Assert.True((await users.SetAuthenticationTokenAsync(first, "test-provider", "token", "private-provider-token")).Succeeded);
                passwordHash = first.PasswordHash!;
                securityStamp = first.SecurityStamp!;
                var db = scope.ServiceProvider.GetRequiredService<HermesDbContext>();
                db.SystemPermissionGrants.Add(new() { UserId = firstId, Code = SystemPermissions.Manage });
                db.Roles.Add(new IdentityRole { Id = "legacy-unused-role", Name = "Unused", NormalizedName = "UNUSED" });
                db.UserRoles.Add(new() { UserId = firstId, RoleId = "legacy-unused-role" });
                await db.SaveChangesAsync();
            }
            using var oldClient = factory.CreateClient();
            await FleetFixture.RefreshCsrfAsync(oldClient);
            Assert.Equal(HttpStatusCode.OK, (await oldClient.PostAsJsonAsync("/api/v1/auth/login", new { email = "shared@one.example.test", password = FleetFixture.Password })).StatusCode);
            await FleetFixture.RefreshCsrfAsync(oldClient);
            // Seed the historical schema directly; today's endpoints depend on later tables.
            var company = new TenantSummary(Guid.NewGuid(), "Meglévő Flotta", []);
            var token = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24));
            var invitationId = Guid.NewGuid();
            var tokenHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
            var pending = new CreatedInvitation(new(invitationId, "future@example.test", [Permissions.VehiclesRead], DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddDays(7), null, null), new(company.Id, invitationId, token));
            var setupContext = new TenantContext(); setupContext.Set(company.Id, firstId, []);
            await using (var setup = FleetFixture.CreateContext(runtime.ConnectionString, setupContext))
            {
                await TenantTransaction.RunAsync(setup, company.Id, async () =>
                {
                    await setup.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenants (\"Id\",\"Name\",\"TimeZone\") VALUES ({company.Id},{company.Name},{"Europe/Budapest"})");
                    await setup.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenant_memberships (\"TenantId\",\"UserSubject\") VALUES ({company.Id},{firstId})");
                    foreach (var code in await setup.PermissionDefinitions.Select(x => x.Code).ToArrayAsync())
                        await setup.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenant_membership_permissions (\"TenantId\",\"UserSubject\",\"Code\") VALUES ({company.Id},{firstId},{code})");
                    setup.Invitations.Add(new() { TenantId = company.Id, Id = invitationId, Email = "future@example.test", NormalizedEmail = "FUTURE@EXAMPLE.TEST", TokenHash = tokenHash, InvitedBy = firstId, ExpiresAt = DateTimeOffset.UtcNow.AddDays(7), Permissions = [new InvitationPermission { TenantId = company.Id, InvitationId = invitationId, Code = Permissions.VehiclesRead }] });
                    setup.AccessAuditEvents.Add(new() { TenantId = company.Id, ActorSubject = firstId, TargetSubject = firstId, Action = "company.created", Details = "{}" });
                    await setup.SaveChangesAsync();
                    return true;
                }, default);
            }
            oldClient.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
            var auditId = Guid.NewGuid();
            var tenantAuditId = Guid.NewGuid();
            var scoped = new TenantContext();
            scoped.Set(company.Id, firstId, Permissions.All);
            string originalDetails;
            await using (var db = FleetFixture.CreateContext(runtime.ConnectionString, scoped))
            {
                await TenantTransaction.RunAsync(db, company.Id, async () =>
                {
                    await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenant_memberships (\"TenantId\",\"UserSubject\",\"Version\") VALUES ({company.Id},{secondId},{7L}), ({company.Id},{"shared"},{1L})");
                    await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenant_membership_permissions (\"TenantId\",\"UserSubject\",\"Code\") VALUES ({company.Id},{secondId},{Permissions.VehiclesRead})");
                    await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO vehicles (\"TenantId\",\"Id\",\"Registration\",\"Make\",\"Model\",\"Status\",\"CreatedAt\") VALUES ({company.Id},{Guid.NewGuid()},{"KEEP-001"},{"Ford"},{"Focus"},{"Active"},{DateTime.UtcNow})");
                    db.SystemAuditEvents.Add(new() { Id = auditId, ActorSubject = firstId, TargetSubject = secondId, Action = "before.username_migration", Details = "{\"unchanged\":true}" });
                    db.AccessAuditEvents.Add(new() { TenantId = company.Id, Id = tenantAuditId, ActorSubject = firstId, TargetSubject = secondId, Action = "before.username_migration", Details = "{\"unchanged\":true}" });
                    await db.SaveChangesAsync();
                    return true;
                }, default);
                originalDetails = (await db.SystemAuditEvents.AsNoTracking().SingleAsync(x => x.Id == auditId)).Details;
            }
            await using (var db = FleetFixture.CreateContext(migrator.ConnectionString, new TenantContext()))
                await db.Database.MigrateAsync();

            Assert.Equal(HttpStatusCode.Unauthorized, (await oldClient.GetAsync("/api/v1/auth/session")).StatusCode);
            using var current = factory.CreateClient();
            await FleetFixture.RefreshCsrfAsync(current);
            Assert.Equal(HttpStatusCode.OK, (await current.PostAsJsonAsync("/api/v1/auth/login", new { userName = "SHARED.2", password = FleetFixture.Password })).StatusCode);
            await FleetFixture.RefreshCsrfAsync(current);
            current.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
            var members = (await current.GetFromJsonAsync<PageResult<MemberSummary>>("/api/v1/members?search=SHARED.3"))!;
            var member = Assert.Single(members.Items);
            Assert.Equal("shared.3", member.UserId);
            Assert.Equal(7, member.Version);
            Assert.Equal(Permissions.VehiclesRead, Assert.Single(member.Permissions));
            Assert.Equal("KEEP-001", Assert.Single((await current.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Registration);
            Assert.Equal(HttpStatusCode.NotFound, (await current.GetAsync($"/api/v1/system/users/{firstId}")).StatusCode);
            var profile = (await current.GetFromJsonAsync<UserProfile>("/api/v1/system/users/shared.3"))!;
            Assert.True(profile.PasswordChangeRequired);
            var audit = Assert.Single((await current.GetFromJsonAsync<PageResult<SystemAuditSummary>>("/api/v1/system/audit-events"))!.Items, x => x.Id == auditId);
            Assert.Equal("shared.2", audit.ActorSubject);
            Assert.Equal("shared.3", audit.TargetSubject);
            Assert.Equal(firstId, audit.OriginalActorSubject);
            Assert.Equal(secondId, audit.OriginalTargetSubject);
            Assert.Equal(originalDetails, audit.Details);
            var tenantAudit = Assert.Single((await current.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!.Items, x => x.Id == tenantAuditId);
            Assert.Equal("shared.2", tenantAudit.ActorSubject);
            Assert.Equal(firstId, tenantAudit.OriginalActorSubject);
            using var futureUser = factory.CreateClient();
            await FleetFixture.RefreshCsrfAsync(futureUser);
            var registration = await futureUser.PostAsJsonAsync("/api/v1/auth/register", new { userName = "future.user", displayName = "Meghívott", email = "future@example.test", password = FleetFixture.Password });
            Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
            await FleetFixture.RefreshCsrfAsync(futureUser);
            Assert.Equal(HttpStatusCode.OK, (await futureUser.PostAsJsonAsync("/api/v1/invitations/accept", pending.Acceptance)).StatusCode);
            await using (var db = FleetFixture.CreateContext(runtime.ConnectionString, new TenantContext()))
            {
                var first = await db.Users.AsNoTracking().SingleAsync(x => x.Id == "shared.2");
                Assert.Equal(passwordHash, first.PasswordHash);
                Assert.NotEqual(securityStamp, first.SecurityStamp);
                Assert.Equal("shared.2", first.UserName);
                Assert.Equal("shared.2", (await db.UserClaims.SingleAsync()).UserId);
                Assert.Equal("shared.2", (await db.UserLogins.SingleAsync()).UserId);
                Assert.Equal("shared.2", (await db.UserTokens.SingleAsync()).UserId);
                Assert.Equal("private-provider-token", (await db.UserTokens.SingleAsync()).Value);
                Assert.Equal("shared.2", (await db.UserRoles.SingleAsync()).UserId);
                Assert.Equal("shared.2", (await db.SystemPermissionGrants.SingleAsync()).UserId);
                Assert.Equal("shared.2", (await db.UserIdentityHistory.SingleAsync(x => x.PreviousId == firstId)).UserId);
                Assert.Null((await db.UserIdentityHistory.SingleAsync(x => x.PreviousId == "shared")).UserId);
                Assert.Equal(64, (await db.Users.SingleAsync(x => x.Email == new string('a', 90) + "@example.test")).Id.Length);
                var original = await db.SystemAuditEvents.SingleAsync(x => x.Id == auditId);
                Assert.Equal(firstId, original.ActorSubject);
                Assert.Equal(secondId, original.TargetSubject);
                Assert.Equal(originalDetails, original.Details);
                Assert.Empty(await db.Vehicles.ToArrayAsync());
                Assert.Empty(await db.MembershipPermissions.ToArrayAsync());
            }
            await using (var connection = new NpgsqlConnection(runtime.ConnectionString))
            {
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand("SELECT count(*) FROM pg_class WHERE relname IN ('vehicles','tenant_membership_permissions','tenant_invitations','tenant_invitation_permissions','access_audit_events') AND relrowsecurity AND relforcerowsecurity", connection);
                Assert.Equal(5L, await command.ExecuteScalarAsync());
            }
            await using (var db = FleetFixture.CreateContext(migrator.ConnectionString, new TenantContext()))
                Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)");
        }
    }
}
