using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class SiteScopeMigrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Site_scope_upgrade_preserves_existing_full_company_grants_and_vehicles()
    {
        var database = $"hermes_site_upgrade_{Guid.NewGuid():N}";
        var connection = new NpgsqlConnectionStringBuilder(fixture.MigrationConnection);
        await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"CREATE DATABASE \"{database}\" OWNER \"{connection.Username}\"");
        connection.Database = database;
        var company = Guid.NewGuid(); var group = Guid.NewGuid(); var vehicle = Guid.NewGuid();
        var context = new TenantContext(); context.Set(company, "historical", Permissions.All);
        try
        {
            await using var db = FleetFixture.CreateContext(connection.ConnectionString, context);
            await db.GetService<IMigrator>().MigrateAsync("20261020151222_CompanyAndSiteManagement");
            await TenantTransaction.RunAsync(db, company, async () =>
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenants (\"Id\",\"Name\",\"TimeZone\") VALUES ({company},'Existing','UTC')");
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO company_access_groups (\"Id\",\"CreatedBy\",\"Name\",\"NormalizedName\",\"IsAdmin\",\"AllPermissions\",\"Version\") VALUES ({group},'historical','Existing','EXISTING',false,false,4)");
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO company_access_scopes (\"GroupId\",\"TenantId\") VALUES ({group},{company})");
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO company_access_permissions (\"GroupId\",\"Code\") VALUES ({group},{Permissions.VehiclesRead})");
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO vehicles (\"TenantId\",\"Id\",\"Registration\",\"Make\",\"Model\",\"Status\",\"CreatedAt\",\"Version\") VALUES ({company},{vehicle},'KEEP-SITE','Ford','Focus','Active',now(),7)");
                return true;
            }, default);
            await db.Database.MigrateAsync();
            Assert.False((await db.GroupCompanies.SingleAsync(x => x.GroupId == group)).RestrictSites);
            Assert.Empty(await db.GroupCompanySites.ToArrayAsync());
            Assert.Equal(4, (await db.PermissionGroups.SingleAsync(x => x.Id == group)).Version);
            Assert.Equal(Permissions.VehiclesRead, (await db.GroupPermissions.SingleAsync(x => x.GroupId == group)).Code);
            await TenantTransaction.RunAsync(db, company, async () =>
            {
                var saved = await db.Vehicles.SingleAsync(x => x.Id == vehicle);
                Assert.Equal("KEEP-SITE", saved.Registration); Assert.Equal(7, saved.Version); return true;
            }, default);
        }
        finally
        {
            await FleetFixture.ExecuteAsync(fixture.AdministrationConnection, $"DROP DATABASE IF EXISTS \"{database}\" WITH (FORCE)");
        }
    }
}
