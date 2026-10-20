using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class CompanyMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Upgrade_preserves_existing_names_fleet_and_archives_and_backfills_only_known_defaults()
    {
        var database = $"hermes_company_upgrade_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{connection.Username}\"");
        connection.Database = database;
        var companyId = Guid.NewGuid();
        var tenant = new TenantContext(); tenant.Set(companyId, "historical", Permissions.All);
        try
        {
            await using var db = FleetFixture.CreateContext(connection.ConnectionString, tenant);
            await db.GetService<IMigrator>().MigrateAsync("20261020112828_AccountLifecycleAndTenantArchive");
            // Only the old schema is available here. The current CLR model already contains the new fields.
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenants (\"Id\",\"Name\",\"TimeZone\") VALUES ({companyId},'Historical company','Europe/Vienna')");
            await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO archived_tenants (\"TenantId\",\"ArchivedAt\",\"Reason\") VALUES ({companyId},now(),'Original archive reason')");
            await TenantTransaction.RunAsync(db, companyId, async () =>
            {
                db.Vehicles.Add(new() { TenantId = companyId, Registration = "KEEP-100", Make = "Ford", Model = "Focus" });
                return await db.SaveChangesAsync();
            }, default);
            await db.Database.MigrateAsync();
            var companies = await db.Tenants.IgnoreQueryFilters().ToArrayAsync();
            Assert.Equal("Historical company", Assert.Single(companies).Name);
            Assert.Equal("Europe/Vienna", companies[0].TimeZone);
            var state = await db.ArchivedTenants.SingleAsync();
            Assert.Equal("Archived", state.Status); Assert.Equal("Original archive reason", state.Reason);
            await TenantTransaction.RunAsync(db, companyId, async () =>
            {
                var profile = await db.CompanyProfiles.SingleAsync();
                Assert.Equal("HU", profile.CountryCode); Assert.Equal("HUF", profile.Currency); Assert.Equal("km", profile.DistanceUnit);
                Assert.Null(profile.LegalName); Assert.Null(profile.CreatedAt); Assert.Null(profile.CreatedBy);
                Assert.Equal("KEEP-100", (await db.Vehicles.SingleAsync()).Registration);
                return true;
            }, default);
            Assert.True(await db.PermissionDefinitions.AnyAsync(x => x.Code == Permissions.SitesAssignVehicles));
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)");
        }
    }
}
