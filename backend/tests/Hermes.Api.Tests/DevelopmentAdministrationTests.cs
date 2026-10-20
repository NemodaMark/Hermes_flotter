using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class DevelopmentAdministrationTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    [Fact]
    public async Task Explicit_local_setup_retires_only_selected_data_and_directory_explains_every_active_account()
    {
        using var owner = await fixture.ClientAsync("anna");
        await using (var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
        {
            db.SystemPermissionGrants.Add(new() { UserId = "anna", Code = SystemPermissions.Manage });
            await db.SaveChangesAsync();
        }
        var company = (await (await owner.PostAsJsonAsync("/api/v1/tenants", new { name = "CI eltávolítandó" })).Content.ReadFromJsonAsync<TenantSummary>())!;
        using var retiredSession = await fixture.ClientAsync("bela");
        using var unassigned = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(unassigned);
        Assert.Equal(HttpStatusCode.Created, (await unassigned.PostAsJsonAsync("/api/v1/auth/register", new { userName = "without.company", email = "none@example.test", displayName = "Cég nélküli", password = FleetFixture.Password })).StatusCode);
        await FleetFixture.RefreshCsrfAsync(unassigned);
        // The ordinary registration policy stays unchanged for all users.
        Assert.Equal(HttpStatusCode.BadRequest, (await unassigned.PostAsJsonAsync("/api/v1/auth/register", new { userName = "short.password", email = "short@example.test", displayName = "Rövid", password = "tiny" })).StatusCode);

        var cleanup = new DevelopmentCleanup(["bela"], [company.Id]);
        await using (var db = FleetFixture.CreateContext(fixture.MigrationConnection, new TenantContext()))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => DevelopmentSetup.Run(db, false, "admin", cleanup, default));
            Assert.False(await db.Users.AnyAsync(x => x.Id == "admin"));
            Assert.Throws<InvalidOperationException>(() => DevelopmentSetup.Validate(true, "Host=database.example;Database=hermes"));
            var result = await DevelopmentSetup.Run(db, true, "admin", cleanup, default);
            Assert.Equal(1, result.ArchivedUsers);
            Assert.Equal(1, result.ArchivedCompanies);
            Assert.Equal(new[] { "admin" }, await db.SystemPermissionGrants.Where(x => x.Code == SystemPermissions.Manage).Select(x => x.UserId).ToArrayAsync());
            Assert.Equal(new[] { "admin" }, await db.GroupUsers.Where(x => db.PermissionGroups.Any(g => g.Id == x.GroupId && g.AllPermissions)).Select(x => x.UserId).ToArrayAsync());
            Assert.True(await db.Users.AnyAsync(x => x.Id == "anna" && x.DisplayName == "Kovács Anna"));
            Assert.True(await db.AccountLifecycles.AnyAsync(x => x.UserId == "bela" && x.IsArchived));
            Assert.True(await db.Tenants.IgnoreQueryFilters().AnyAsync(x => x.Id == company.Id));
            Assert.False(await db.Tenants.AnyAsync(x => x.Id == company.Id));
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await retiredSession.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await owner.GetAsync("/api/v1/auth/session")).StatusCode);
        using var deniedLogin = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(deniedLogin);
        Assert.Equal(HttpStatusCode.Unauthorized, (await deniedLogin.PostAsJsonAsync("/api/v1/auth/login", new { userName = "bela", password = FleetFixture.Password })).StatusCode);

        using var admin = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(admin);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync("/api/v1/auth/login", new { userName = "admin", password = "admin" })).StatusCode);
        await FleetFixture.RefreshCsrfAsync(admin);
        var directory = (await admin.GetFromJsonAsync<PageResult<UserProfile>>("/api/v1/system/users"))!;
        Assert.Equal(3, directory.Total);
        Assert.DoesNotContain(directory.Items, x => x.Id == "bela");
        Assert.True(Assert.Single(directory.Items, x => x.Id == "admin").IsAdministrator);
        var retained = Assert.Single(directory.Items, x => x.Id == "anna");
        Assert.False(retained.IsAdministrator);
        Assert.Contains(retained.CompanyAccess, x => x.Id == TestFleetData.DunaId && x.HasAccess && !x.IsAdmin);
        var none = (await admin.GetFromJsonAsync<PageResult<UserProfile>>("/api/v1/system/users?access=none"))!;
        Assert.Equal("without.company", Assert.Single(none.Items).Id);
        var admins = (await admin.GetFromJsonAsync<PageResult<UserProfile>>("/api/v1/system/users?role=admin"))!;
        Assert.Equal("admin", Assert.Single(admins.Items).Id);
        Assert.Equal(2, (await admin.GetFromJsonAsync<PageResult<UserProfile>>("/api/v1/system/users?role=member"))!.Total);
        Assert.Equal("without.company", Assert.Single((await admin.GetFromJsonAsync<PageResult<UserProfile>>("/api/v1/system/users?search=Cég%20nélküli"))!.Items).Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/v1/system/users?role=invalid")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/v1/system/users/bela")).StatusCode);
        using var ordinary = await fixture.ClientAsync("anna");
        Assert.Equal(HttpStatusCode.Forbidden, (await ordinary.GetAsync("/api/v1/system/users")).StatusCode);
        var companies = (await admin.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!;
        Assert.Equal(2, companies.Length);
        Assert.DoesNotContain(companies, x => x.Id == company.Id);
        admin.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/v1/vehicles")).StatusCode);
        admin.DefaultRequestHeaders.Remove("X-Tenant-Id");
        admin.DefaultRequestHeaders.Add("X-Tenant-Id", TestFleetData.DunaId.ToString());
        Assert.Equal(2, (await admin.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!.Length);
        var audit = (await admin.GetFromJsonAsync<PageResult<SystemAuditSummary>>("/api/v1/system/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "user.test_account_archived" && x.TargetSubject == "bela");
        Assert.Contains(audit.Items, x => x.Action == "user.admin_access_revoked" && x.TargetSubject == "anna");
        Assert.Contains(audit.Items, x => x.Action == "company.created" && x.TargetSubject == "anna");
        Assert.DoesNotContain(audit.Items, x => x.Details.Contains("PasswordHash") || x.Details.Contains("SecurityStamp"));
        await using (var db = FleetFixture.CreateContext(fixture.MigrationConnection, new TenantContext()))
        {
            await DevelopmentSetup.Run(db, true, "admin", cleanup, default);
            Assert.Single(await db.Users.Where(x => x.Id == "admin").ToArrayAsync());
            Assert.Single(await db.PermissionGroups.Where(x => x.IsAdmin).ToArrayAsync());
        }
        // Production must refuse the intentionally weak local development account.
        using var production = fixture.CreateFactory("Production");
        using var productionClient = production.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        await FleetFixture.RefreshCsrfAsync(productionClient);
        Assert.Equal(HttpStatusCode.Unauthorized, (await productionClient.PostAsJsonAsync("/api/v1/auth/login", new { userName = "admin", password = "admin" })).StatusCode);
        // A valid Development cookie cannot bypass the Production login restriction.
        using var fresh = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(fresh);
        var freshLogin = await fresh.PostAsJsonAsync("/api/v1/auth/login", new { userName = "admin", password = "admin" });
        var cookie = freshLogin.Headers.GetValues("Set-Cookie").Single(x => x.StartsWith("Hermes.Session=")).Split(';')[0];
        productionClient.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await productionClient.GetAsync("/api/v1/auth/session")).StatusCode);
    }
}
