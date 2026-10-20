using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class SharedAdminMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Merge_preserves_exact_admin_company_pairs_custom_groups_and_suspension_and_enforces_scope_fk()
    {
        var database = $"hermes_admin_merge_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{connection.Username}\"");
        connection.Database = database;
        var first = Guid.Parse("10000000-0000-4000-8000-000000000001");
        var second = Guid.Parse("10000000-0000-4000-8000-000000000002");
        var third = Guid.Parse("10000000-0000-4000-8000-000000000003");
        try
        {
            await using var db = FleetFixture.CreateContext(connection.ConnectionString, new TenantContext());
            await db.GetService<IMigrator>().MigrateAsync("20261020094622_UnifiedPermissionGroups");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO identity_users ("Id","DisplayName","UserName","NormalizedUserName","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount") VALUES
                  ('alice','Alice','alice','ALICE',false,false,false,false,0),
                  ('bruno','Bruno','bruno','BRUNO',false,false,false,false,0),
                  ('charlie','Charlie','charlie','CHARLIE',false,false,false,false,0);
                INSERT INTO tenants ("Id","Name","TimeZone") VALUES
                  ('10000000-0000-4000-8000-000000000001','First','Europe/Budapest'),
                  ('10000000-0000-4000-8000-000000000002','Second','Europe/Budapest'),
                  ('10000000-0000-4000-8000-000000000003','Third','Europe/Budapest');
                INSERT INTO tenant_memberships ("TenantId","UserSubject","IsActive","HasDirectAccess","Version") VALUES
                  ('10000000-0000-4000-8000-000000000001','alice',true,true,7),
                  ('10000000-0000-4000-8000-000000000001','bruno',true,false,8),
                  ('10000000-0000-4000-8000-000000000002','bruno',true,true,9),
                  ('10000000-0000-4000-8000-000000000002','charlie',false,true,12),
                  ('10000000-0000-4000-8000-000000000003','bruno',true,false,5);
                INSERT INTO company_access_groups ("Id","CreatedBy","Name","NormalizedName","IsAdmin","AllPermissions","Version") VALUES
                  ('20000000-0000-4000-8000-000000000001','alice','admin','ADMIN',true,true,3),
                  ('20000000-0000-4000-8000-000000000002','bruno','admin','ADMIN',true,true,8),
                  ('20000000-0000-4000-8000-000000000003','alice','Reader','READER',false,false,2);
                INSERT INTO company_access_scopes ("GroupId","TenantId") VALUES
                  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
                  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
                  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001'),
                  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003');
                INSERT INTO company_access_users ("GroupId","UserId") VALUES
                  ('20000000-0000-4000-8000-000000000001','alice'),
                  ('20000000-0000-4000-8000-000000000002','bruno'),
                  ('20000000-0000-4000-8000-000000000002','charlie'),
                  ('20000000-0000-4000-8000-000000000003','bruno');
                INSERT INTO company_access_permissions ("GroupId","Code") VALUES ('20000000-0000-4000-8000-000000000003','vehicles.read');
                SELECT set_config('app.tenant_id','10000000-0000-4000-8000-000000000001',true);
                INSERT INTO company_access_memberships ("GroupId","UserSubject","TenantId") VALUES
                  ('20000000-0000-4000-8000-000000000001','alice','10000000-0000-4000-8000-000000000001'),
                  ('20000000-0000-4000-8000-000000000003','bruno','10000000-0000-4000-8000-000000000001');
                INSERT INTO tenant_membership_permissions ("TenantId","UserSubject","Code") VALUES ('10000000-0000-4000-8000-000000000001','alice','vehicles.read');
                INSERT INTO access_audit_events ("TenantId","Id","ActorSubject","Action","Details","CreatedAt") VALUES
                  ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','alice','group.created',jsonb_build_object('historical',true),now());
                SELECT set_config('app.tenant_id','10000000-0000-4000-8000-000000000002',true);
                INSERT INTO company_access_memberships ("GroupId","UserSubject","TenantId") VALUES
                  ('20000000-0000-4000-8000-000000000002','bruno','10000000-0000-4000-8000-000000000002'),
                  ('20000000-0000-4000-8000-000000000002','charlie','10000000-0000-4000-8000-000000000002');
                SELECT set_config('app.tenant_id','10000000-0000-4000-8000-000000000003',true);
                INSERT INTO company_access_memberships ("GroupId","UserSubject","TenantId") VALUES
                  ('20000000-0000-4000-8000-000000000003','bruno','10000000-0000-4000-8000-000000000003');
                """);
            await db.Database.MigrateAsync();
            var groups = await db.PermissionGroups.Include(x => x.Permissions).ToArrayAsync();
            Assert.Equal(2, groups.Length);
            var admin = Assert.Single(groups, x => x.IsAdmin);
            Assert.Equal(9, admin.Version);
            Assert.Equal(Permissions.All.Order(), admin.EffectivePermissions.Order());
            Assert.Equal(2, Assert.Single(groups, x => !x.IsAdmin).Version);
            Assert.All(await db.Users.ToArrayAsync(), x => Assert.Equal(2, x.ProfileVersion));
            var scopes = await db.GroupUserCompanies.Where(x => x.GroupId == admin.Id).ToArrayAsync();
            Assert.Equal(3, scopes.Length);
            Assert.Equal(first, Assert.Single(scopes, x => x.UserId == "alice").TenantId);
            Assert.Equal(second, Assert.Single(scopes, x => x.UserId == "bruno").TenantId);
            Assert.Equal(second, Assert.Single(scopes, x => x.UserId == "charlie").TenantId);
            Assert.Equal(5, await db.GroupUserCompanies.CountAsync());
            Assert.Equal(2, await db.SystemAuditEvents.CountAsync(x => x.Action == "admin_group.consolidated"));
            foreach (var id in new[] { first, second, third })
            {
                var context = new TenantContext(); context.Set(id, "alice", []);
                await using var scoped = FleetFixture.CreateContext(connection.ConnectionString, context);
                await TenantTransaction.RunAsync(scoped, id, async () =>
                {
                    var members = await scoped.Memberships.Include(x => x.Permissions).Include(x => x.Groups).ThenInclude(x => x.Group).ThenInclude(x => x.Permissions)
                        .Where(x => x.TenantId == id).ToDictionaryAsync(x => x.UserSubject);
                    if (id == first)
                    {
                        Assert.Equal(8, members["alice"].Version);
                        Assert.Equal([Permissions.VehiclesRead], members["bruno"].EffectivePermissions);
                        Assert.False(members["bruno"].HasDirectAccess);
                        Assert.Single(members["alice"].Permissions);
                        Assert.Contains("historical", (await scoped.AccessAuditEvents.SingleAsync(x => x.Action == "group.created")).Details);
                        await scoped.Database.CurrentTransaction!.CreateSavepointAsync("scope_forgery");
                        var error = await Assert.ThrowsAsync<PostgresException>(() => scoped.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO company_access_memberships (\"GroupId\",\"UserSubject\",\"TenantId\") VALUES ({admin.Id},{"bruno"},{first})"));
                        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, error.SqlState);
                        await scoped.Database.CurrentTransaction.RollbackToSavepointAsync("scope_forgery");
                    }
                    else if (id == second)
                    {
                        Assert.Equal(10, members["bruno"].Version);
                        Assert.Equal(Permissions.All.Order(), members["bruno"].EffectivePermissions.Order());
                        Assert.False(members["charlie"].IsActive);
                        Assert.Equal(13, members["charlie"].Version);
                    }
                    else
                    {
                        Assert.Equal(5, members["bruno"].Version);
                        Assert.Equal([Permissions.VehiclesRead], members["bruno"].EffectivePermissions);
                        Assert.DoesNotContain(await scoped.MembershipGroups.ToArrayAsync(), x => x.GroupId == admin.Id);
                    }
                    return true;
                }, default);
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)");
        }
    }
}
