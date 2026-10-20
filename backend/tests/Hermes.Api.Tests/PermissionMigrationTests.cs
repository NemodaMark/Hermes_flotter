using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class PermissionMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Upgrade_preserves_accounts_fleet_and_legacy_access_as_explicit_grants()
    {
        var database = $"hermes_upgrade_{Guid.NewGuid():N}";
        var migrator = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{migrator.Username}\"");
        migrator.Database = database;
        var tenant = Guid.NewGuid();
        try
        {
            await using var db = FleetFixture.CreateContext(migrator.ConnectionString, new TenantContext());
            await db.GetService<IMigrator>().MigrateAsync("20261019224051_IdentityAccounts");
            // Seed the actual old schema, not the new CLR membership model.
            await using (var connection = new NpgsqlConnection(migrator.ConnectionString))
            {
                await connection.OpenAsync();
                await using var tx = await connection.BeginTransactionAsync();
                await using var command = new NpgsqlCommand("""
                    SELECT set_config('app.tenant_id', @tenantText, true);
                    INSERT INTO tenants ("Id", "Name", "TimeZone") VALUES (@tenant, 'Meglévő cég', 'Europe/Budapest');
                    INSERT INTO tenant_memberships ("TenantId", "UserSubject", "Role") VALUES
                        (@tenant, 'legacy-owner', 'Owner'), (@tenant, 'legacy-manager', 'FleetManager'), (@tenant, 'legacy-viewer', 'Viewer');
                    INSERT INTO vehicles ("TenantId", "Id", "Registration", "Make", "Model", "Status", "CreatedAt")
                        VALUES (@tenant, @vehicle, 'OLD-001', 'Ford', 'Focus', 'Active', now());
                    """, connection, tx);
                command.Parameters.AddWithValue("tenant", tenant);
                command.Parameters.AddWithValue("tenantText", tenant.ToString());
                command.Parameters.AddWithValue("vehicle", Guid.NewGuid());
                await command.ExecuteNonQueryAsync();
                await tx.CommitAsync();
            }
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO identity_users ("Id", "DisplayName", "UserName", "Email", "NormalizedEmail", "PasswordHash",
                    "EmailConfirmed", "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
                VALUES ('legacy-owner', 'Meglévő felhasználó', 'old@example.test', 'old@example.test', 'OLD@EXAMPLE.TEST',
                    'existing-password-hash', false, false, false, false, 0);
                """);
            await db.Database.MigrateAsync();
            Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            Assert.Equal("existing-password-hash", (await db.Users.AsNoTracking().SingleAsync()).PasswordHash);
            Assert.False((await db.Users.AsNoTracking().SingleAsync()).PasswordChangeRequired);
            Assert.Equal(1, (await db.Users.AsNoTracking().SingleAsync()).ProfileVersion);
            Assert.Empty(await db.SystemPermissionGrants.ToArrayAsync());
            var scoped = new TenantContext();
            scoped.Set(tenant, "legacy-owner", Permissions.All);
            await using var upgraded = FleetFixture.CreateContext(migrator.ConnectionString, scoped);
            await TenantTransaction.RunAsync(upgraded, tenant, async () =>
            {
                var members = await upgraded.Memberships.Include(item => item.Permissions).ToDictionaryAsync(item => item.UserSubject);
                Assert.Equal(Permissions.All.Order(), members["legacy-owner"].Permissions.Select(item => item.Code).Order());
                Assert.Equal(new[] { Permissions.VehiclesCreate, Permissions.VehiclesRead }, members["legacy-manager"].Permissions.Select(item => item.Code).Order());
                Assert.Equal(Permissions.VehiclesRead, Assert.Single(members["legacy-viewer"].Permissions).Code);
                Assert.All(members.Values, member => { Assert.True(member.IsActive); Assert.Equal(1, member.Version); });
                Assert.Equal("OLD-001", (await upgraded.Vehicles.SingleAsync()).Registration);
                Assert.Equal(3, await upgraded.AccessAuditEvents.CountAsync(item => item.Action == "permissions.migrated"));
                return true;
            }, default);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)");
        }
    }
}
