using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class VehicleManagementMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Upgrade_backfills_all_companies_without_changing_vehicle_keys_versions_or_inventing_technical_data()
    {
        var database = $"hermes_vehicle_upgrade_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{connection.Username}\"");
        connection.Database = database;
        var companies = new[] { Guid.NewGuid(), Guid.NewGuid() }; var vehicles = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var context = new TenantContext();
        try
        {
            await using var db = FleetFixture.CreateContext(connection.ConnectionString, context);
            await db.GetService<IMigrator>().MigrateAsync("20261020164020_GroupSiteScopes");
            for (var index = 0; index < companies.Length; index++)
            {
                var company = companies[index]; var vehicle = vehicles[index]; var companyContext = new TenantContext(); companyContext.Set(company, "existing", Permissions.All);
                await using var companyDb = FleetFixture.CreateContext(connection.ConnectionString, companyContext);
                await TenantTransaction.RunAsync(companyDb, company, async () =>
                {
                    await companyDb.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenants (\"Id\",\"Name\",\"TimeZone\") VALUES ({company},'Existing','UTC')");
                    await companyDb.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO vehicles (\"TenantId\",\"Id\",\"Registration\",\"Make\",\"Model\",\"Status\",\"CreatedAt\",\"Version\",\"OdometerKm\") VALUES ({company},{vehicle},'OLD-001','Ford','Transit','Maintenance','2026-01-01T00:00:00Z',7,12345)");
                    return true;
                }, default);
            }
            await db.Database.MigrateAsync();
            Assert.False(db.Database.HasPendingModelChanges());
            for (var index = 0; index < companies.Length; index++)
            {
                var company = companies[index]; var companyContext = new TenantContext(); companyContext.Set(company, "existing", Permissions.All);
                await using var companyDb = FleetFixture.CreateContext(connection.ConnectionString, companyContext);
                await TenantTransaction.RunAsync(companyDb, company, async () =>
                {
                    var car = await companyDb.Vehicles.AsNoTracking().SingleAsync(); Assert.Equal(vehicles[index], car.Id); Assert.Equal(7, car.Version);
                    Assert.Equal(12345, car.OdometerKm); Assert.Equal(VehicleStatus.Maintenance, car.Status);
                    var profile = await companyDb.VehicleProfiles.AsNoTracking().SingleAsync(); Assert.Equal(car.Id, profile.VehicleId);
                    Assert.Null(profile.Vin); Assert.Equal("Unknown", profile.Ownership); Assert.Equal("Unknown", profile.Category);
                    var history = await companyDb.VehicleRegistrations.AsNoTracking().SingleAsync(); Assert.Equal(car.Id, history.VehicleId);
                    Assert.Equal("OLD-001", history.Registration); Assert.Equal("system:migration", history.RecordedBy); Assert.Equal(car.CreatedAt, history.RecordedAt.UtcDateTime);
                    Assert.Empty(await companyDb.Partners.ToArrayAsync()); Assert.Empty(await companyDb.VehicleLeases.ToArrayAsync()); Assert.Empty(await companyDb.VehicleServices.ToArrayAsync());
                    return true;
                }, default);
            }
            Assert.Equal(Permissions.Catalog.Count, await db.PermissionDefinitions.CountAsync());
        }
        finally { await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)"); }
    }
}
