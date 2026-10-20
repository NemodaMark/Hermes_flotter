using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class UnifiedGroupMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Upgrade_preserves_both_group_models_colliding_ids_orphans_and_suspension()
    {
        var database = $"hermes_unify_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{connection.Username}\"");
        connection.Database = database;
        try
        {
            await using var db = FleetFixture.CreateContext(connection.ConnectionString, new TenantContext());
            await db.GetService<IMigrator>().MigrateAsync("20261020091751_MultiCompanyAccessGroups");
            // Deliberately use the historical schema, including colliding UUIDs and an orphan subject.
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO identity_users ("Id","DisplayName","UserName","NormalizedUserName","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
                  VALUES ('alice','Alice','alice','ALICE',false,false,false,false,0);
                INSERT INTO tenants ("Id","Name","TimeZone") VALUES
                  ('10000000-0000-4000-8000-000000000001','First','Europe/Budapest'),
                  ('10000000-0000-4000-8000-000000000002','Second','Europe/Budapest');
                INSERT INTO tenant_memberships ("TenantId","UserSubject","IsActive","HasDirectAccess","Version") VALUES
                  ('10000000-0000-4000-8000-000000000001','alice',false,true,8),
                  ('10000000-0000-4000-8000-000000000001','orphan',true,true,4),
                  ('10000000-0000-4000-8000-000000000002','alice',true,false,3);
                INSERT INTO user_identity_history ("PreviousId","UserId") VALUES ('orphan',null);
                INSERT INTO company_access_groups ("Id","CreatedBy","Name","NormalizedName","AllPermissions","Version")
                  VALUES ('20000000-0000-4000-8000-000000000001','alice','Existing','EXISTING',false,7);
                INSERT INTO company_access_scopes ("GroupId","TenantId")
                  VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
                INSERT INTO company_access_users ("GroupId","UserId") VALUES ('20000000-0000-4000-8000-000000000001','alice');
                INSERT INTO company_access_permissions ("GroupId","Code") VALUES ('20000000-0000-4000-8000-000000000001','vehicles.read');
                SELECT set_config('app.tenant_id','10000000-0000-4000-8000-000000000002',true);
                INSERT INTO company_access_memberships ("GroupId","TenantId","UserSubject") VALUES
                  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','alice');
                INSERT INTO permission_groups ("TenantId","Id","Name","NormalizedName","IsAdmin","Version") VALUES
                  ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Same name','SAME NAME',false,5);
                INSERT INTO tenant_membership_groups ("TenantId","UserSubject","GroupId") VALUES
                  ('10000000-0000-4000-8000-000000000002','alice','20000000-0000-4000-8000-000000000001');
                INSERT INTO permission_group_permissions ("TenantId","GroupId","Code") VALUES
                  ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','vehicles.odometer.create');
                SELECT set_config('app.tenant_id','10000000-0000-4000-8000-000000000001',true);
                INSERT INTO permission_groups ("TenantId","Id","Name","NormalizedName","IsAdmin","Version") VALUES
                  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Same name','SAME NAME',false,2),
                  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','admin','ADMIN',true,1);
                INSERT INTO tenant_membership_groups ("TenantId","UserSubject","GroupId") VALUES
                  ('10000000-0000-4000-8000-000000000001','orphan','20000000-0000-4000-8000-000000000001'),
                  ('10000000-0000-4000-8000-000000000001','alice','20000000-0000-4000-8000-000000000002');
                INSERT INTO permission_group_permissions ("TenantId","GroupId","Code") VALUES
                  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','members.read');
                INSERT INTO access_audit_events ("TenantId","Id","ActorSubject","Action","Details","CreatedAt") VALUES
                  ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','orphan','group.created',jsonb_build_object('historical',true),now());
                """);
            await db.Database.MigrateAsync();
            var groups = await db.PermissionGroups.Include(x => x.Companies).Include(x => x.Permissions).ToArrayAsync();
            Assert.Equal(4, groups.Length);
            Assert.Equal(4, groups.Select(x => x.Id).Distinct().Count());
            Assert.Equal(7, Assert.Single(groups, x => x.Name == "Existing").Version);
            Assert.Equal(2, groups.Count(x => x.Name == "Same name"));
            Assert.All(groups.Where(x => x.Name == "Same name"), x => Assert.Single(x.Companies));
            Assert.Equal(Permissions.All.Order(), Assert.Single(groups, x => x.IsAdmin).EffectivePermissions.Order());
            Assert.Equal(2, (await db.Users.SingleAsync()).ProfileVersion);
            foreach (var id in new[] { TestFleetData.DunaId, TestFleetData.PannonId })
            {
                var context = new TenantContext(); context.Set(id, "alice", []);
                await using var scoped = FleetFixture.CreateContext(connection.ConnectionString, context);
                await TenantTransaction.RunAsync(scoped, id, async () =>
                {
                    var members = await scoped.Memberships.Include(x => x.Permissions).Include(x => x.Groups).ThenInclude(x => x.Group).ThenInclude(x => x.Permissions)
                        .Where(x => x.TenantId == id).ToDictionaryAsync(x => x.UserSubject);
                    if (id == TestFleetData.DunaId)
                    {
                        Assert.False(members["alice"].IsActive);
                        Assert.True(members["alice"].HasDirectAccess);
                        Assert.Equal(9, members["alice"].Version);
                        Assert.Equal([Permissions.MembersRead], members["orphan"].EffectivePermissions);
                        Assert.Equal(3, await scoped.AccessAuditEvents.CountAsync(x => x.Action == "group.unified" || x.Action == "group.created"));
                    }
                    else
                    {
                        Assert.False(members["alice"].HasDirectAccess);
                        Assert.Equal(4, members["alice"].Version);
                        Assert.Equal(new[] { Permissions.OdometerCreate, Permissions.VehiclesRead }.Order(), members["alice"].EffectivePermissions.Order());
                    }
                    return true;
                }, default);
            }
            Assert.Equal(3, await db.SystemAuditEvents.CountAsync(x => x.Action == "group.unified"));
            Assert.Null(await db.Database.SqlQueryRaw<string?>("SELECT to_regclass('permission_groups')::text AS \"Value\"").SingleAsync());
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)");
        }
    }
}
