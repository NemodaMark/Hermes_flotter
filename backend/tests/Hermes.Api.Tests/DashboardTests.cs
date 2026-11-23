using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    [Fact]
    public async Task Dashboard_booking_flag_is_fresh_and_follows_its_own_site_and_company_scope()
    {
        using var owner = await Register(); using var driver = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Company(foreign);
        var a = await ScopeSite(owner, "BOOK-A"); var b = await ScopeSite(owner, "BOOK-B");
        var carA = await FleetCar(owner, "FLAG-A", a.Id); var carB = await FleetCar(owner, "FLAG-B", b.Id);
        var other = await FleetCar(foreign, "FLAG-FOREIGN");
        await Join(owner, driver, company.Id, Permissions.VehiclesRead, Permissions.FleetOverviewRead);
        var bookings = await ScopedGroup(owner, "A foglalási jog", company.Id, [a.Id], Permissions.BookingsRead);
        await CompanyAssign(owner, driver.User.Id, bookings.Id); Select(driver, company.Id);
        var before = (await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        Assert.False(Assert.Single(before.Vehicles, x => x.Vehicle.Id == carA.Vehicle.Id).BookingEnabled);
        foreach (var car in new[] { carA, carB })
            (await owner.Client.PutAsJsonAsync(CarUrl(car) + "/booking-settings", new BookingSettingsInput(true))).EnsureSuccessStatusCode();
        var enabled = (await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        Assert.True(Assert.Single(enabled.Vehicles, x => x.Vehicle.Id == carA.Vehicle.Id).BookingEnabled);
        Assert.Null(Assert.Single(enabled.Vehicles, x => x.Vehicle.Id == carB.Vehicle.Id).BookingEnabled);
        Assert.True((await driver.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(carA) + "/details"))!.BookingEnabled);
        Assert.Null((await driver.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(carB) + "/details"))!.BookingEnabled);
        Assert.DoesNotContain(enabled.Vehicles, x => x.Vehicle.Id == other.Vehicle.Id);
        (await owner.Client.PutAsJsonAsync(CarUrl(carA) + "/booking-settings", new BookingSettingsInput(false))).EnsureSuccessStatusCode();
        Assert.False(Assert.Single((await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Vehicles, x => x.Vehicle.Id == carA.Vehicle.Id).BookingEnabled);
        Assert.False((await driver.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(carA) + "/details"))!.BookingEnabled);
    }

    private static async Task<PermissionGroupSummary> DashboardGroup(Account owner, PermissionGroupSummary group, string mode, int priority)
        => await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}/dashboard", new GroupDashboardInput(mode, priority, group.Version)));

    [Fact]
    public async Task Dashboard_priority_is_company_specific_ties_fall_back_and_changes_are_fresh_and_audited()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner); Select(owner, first.Id);
        await Join(owner, member, first.Id, Permissions.VehiclesRead, Permissions.FleetOverviewRead);
        var overview = await CompanyGroup(owner, "Áttekintő", [first.Id], Permissions.VehiclesRead);
        var studio = await CompanyGroup(owner, "Autós", [first.Id], Permissions.VehiclesRead);
        var other = await CompanyGroup(owner, "Másik cég", [second.Id], Permissions.VehiclesRead);
        overview = await DashboardGroup(owner, overview, "Overview", 20);
        studio = await DashboardGroup(owner, studio, "Vehicle", 10);
        other = await DashboardGroup(owner, other, "Vehicle", 900);
        await CompanyAssign(owner, member.User.Id, overview.Id, studio.Id, other.Id);
        Select(member, first.Id);
        Assert.Equal("Overview", (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Mode);
        studio = await DashboardGroup(owner, studio, "Vehicle", 30);
        Assert.Equal("Vehicle", (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Mode);
        overview = await DashboardGroup(owner, overview, "Overview", 30);
        Assert.Equal("Overview", (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Mode);
        await CompanyAssign(owner, member.User.Id, studio.Id, other.Id);
        Assert.Equal("Vehicle", (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Mode);
        await CompanyAssign(owner, member.User.Id, other.Id);
        Assert.Equal("Overview", (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Mode);
        Select(member, second.Id);
        Assert.Equal(900, (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Priority);
        var history = await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events");
        Assert.Contains(history!.Items, x => x.Action == "group.dashboard_changed" && x.Details.Contains("Vehicle"));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{studio.Id}/dashboard", new GroupDashboardInput("Overview", 0, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{studio.Id}/dashboard", new GroupDashboardInput("Other", 0, studio.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{studio.Id}/dashboard", new GroupDashboardInput("Vehicle", 1001, studio.Version))).StatusCode);
    }

    [Fact]
    public async Task Dashboard_does_not_expand_scopes_or_expose_foreign_assigned_or_unassigned_vehicles()
    {
        using var owner = await Register(); using var member = await Register(); using var stranger = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var carA = await ScopeCar(owner, "DASH-A", a.Id); var carB = await ScopeCar(owner, "DASH-B", b.Id); var none = await ScopeCar(owner, "DASH-NONE");
        var read = await ScopedGroup(owner, "A olvasás", company.Id, [a.Id], Permissions.VehiclesRead);
        var km = await ScopedGroup(owner, "B kilométer", company.Id, [b.Id], Permissions.OdometerCreate);
        await DashboardGroup(owner, read, "Vehicle", 50);
        await CompanyAssign(owner, member.User.Id, read.Id, km.Id);
        await ScopeOk<object>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{carB.Id}/assignee", new { userId = member.User.Id, version = carB.Version }));
        Select(member, company.Id);
        var dashboard = (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        Assert.Empty(dashboard.Vehicles); // An unreadable assignment must not fall back to another car.
        Assert.Equal("Vehicle", dashboard.Mode);
        await ScopeOk<object>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{carA.Id}/assignee", new { userId = member.User.Id, version = carA.Version }));
        dashboard = (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        var car = Assert.Single(dashboard.Vehicles);
        Assert.Equal(carA.Id, car.Vehicle.Id); Assert.True(car.IsAssignedToMe);
        Assert.DoesNotContain(Permissions.OdometerCreate, car.Vehicle.Permissions);
        Assert.DoesNotContain(dashboard.Vehicles, x => x.Vehicle.Id == carB.Id || x.Vehicle.Id == none.Id);
        Select(stranger, company.Id); Assert.Equal(HttpStatusCode.Forbidden, (await stranger.Client.GetAsync("/api/v1/dashboard")).StatusCode);
        Select(owner, company.Id);
        var access = await Access(owner, member.User.Id);
        await owner.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { isActive = false, version = access.Version });
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/dashboard")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_overview_requires_its_own_grant_and_aggregates_only_overlapping_vehicle_sites()
    {
        using var owner = await Register(); using var driver = await Register(); using var foreign = await Register();
        var company = await Company(owner);
        var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B"); var c = await ScopeSite(owner, "C");
        var carA = await ScopeCar(owner, "FLEET-A", a.Id);
        var carB = await ScopeCar(owner, "FLEET-B", b.Id);
        var carC = await ScopeCar(owner, "FLEET-C", c.Id);
        var firstReadingOnly = await ScopeCar(owner, "FLEET-FRESH", b.Id);
        var unassigned = await ScopeCar(owner, "FLEET-NONE");
        var foreignCompany = await Company(foreign);
        var read = await ScopedGroup(owner, "A és B járművei", company.Id, [a.Id, b.Id], Permissions.VehiclesRead);
        var overview = await ScopedGroup(owner, "B és C áttekintője", company.Id, [b.Id, c.Id], Permissions.FleetOverviewRead);
        await CompanyAssign(owner, driver.User.Id, read.Id);
        Select(driver, company.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync("/api/v1/dashboard/overview")).StatusCode);
        var personal = (await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        Assert.False(personal.CanReadOverview);
        Assert.Equal("Vehicle", personal.Mode);

        var now = DateTimeOffset.UtcNow;
        var period = new DateTimeOffset(now.Year, now.Month, 12, 12, 0, 0, TimeSpan.Zero).AddMonths(-2);
        var before = period.AddMonths(-5);
        var context = new TenantContext();
        context.Set(company.Id, owner.User.Id, Permissions.All);
        await using (var db = FleetFixture.CreateContext(fixture.MigrationConnection, context))
        {
            await TenantTransaction.RunAsync(db, company.Id, async () =>
            {
                foreach (var (id, km) in new[] { (carA.Id, 1000L), (carB.Id, 350L), (carC.Id, 900L), (unassigned.Id, 800L) })
                {
                    db.OdometerReadings.Add(new() { TenantId = company.Id, VehicleId = id, RecordedAt = before, Kilometers = 10000, RecordedBy = owner.User.Id });
                    db.OdometerReadings.Add(new() { TenantId = company.Id, VehicleId = id, RecordedAt = period, Kilometers = 10000 + km, RecordedBy = owner.User.Id });
                }
                db.OdometerReadings.Add(new() { TenantId = company.Id, VehicleId = carB.Id, RecordedAt = period.AddMonths(1), Kilometers = 10500, RecordedBy = owner.User.Id });
                db.OdometerReadings.Add(new() { TenantId = company.Id, VehicleId = firstReadingOnly.Id, RecordedAt = period, Kilometers = 78231, RecordedBy = owner.User.Id });
                return await db.SaveChangesAsync();
            }, CancellationToken.None);
        }

        await CompanyAssign(owner, driver.User.Id, read.Id, overview.Id);
        Assert.True((await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.CanReadOverview);
        var result = (await driver.Client.GetFromJsonAsync<DashboardOverview>($"/api/v1/dashboard/overview?site={b.Id}"))!;
        Assert.Equal(new[] { carB.Id, firstReadingOnly.Id }, result.Vehicles.Select(x => x.Vehicle.Id));
        Assert.Equal(6, result.MonthlyMileage.Length);
        Assert.Equal(new long?[] { 350, 150 }, result.MonthlyMileage.Where(x => x.Kilometers.HasValue).Select(x => x.Kilometers));
        var top = Assert.Single(result.TopVehicles);
        Assert.Equal(carB.Id, top.VehicleId);
        Assert.Equal(500, top.Kilometers);
        var all = (await driver.Client.GetFromJsonAsync<DashboardOverview>("/api/v1/dashboard/overview"))!;
        Assert.Equal(result.TopVehicles, all.TopVehicles);
        foreach (var site in new[] { a.Id.ToString(), c.Id.ToString(), "none" })
        {
            var empty = (await driver.Client.GetFromJsonAsync<DashboardOverview>($"/api/v1/dashboard/overview?site={site}"))!;
            Assert.Empty(empty.Vehicles);
            Assert.Empty(empty.TopVehicles);
            Assert.All(empty.MonthlyMileage, x => Assert.Null(x.Kilometers));
        }
        Select(driver, foreignCompany.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync("/api/v1/dashboard/overview")).StatusCode);
        Select(driver, company.Id);
        await CompanyAssign(owner, driver.User.Id, read.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.Client.GetAsync("/api/v1/dashboard/overview")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_legacy_group_edits_preserve_preferences_and_readless_members_receive_no_car_data()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); await ScopeCar(owner, "DASH-HIDDEN");
        var group = await CompanyGroup(owner, "Csak kilométer", [company.Id], Permissions.OdometerCreate);
        group = await DashboardGroup(owner, group, "Vehicle", 80);
        var updated = await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}",
            new UpdateGroupRequest("Átnevezve", group.Permissions, [company.Id], group.Version)));
        Assert.Equal("Vehicle", updated.DashboardMode); Assert.Equal(80, updated.DashboardPriority);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        var result = (await member.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        Assert.Equal("Vehicle", result.Mode); Assert.False(result.CanReadVehicles); Assert.Empty(result.Vehicles);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
    }

    [Fact]
    public async Task Dashboard_settings_require_all_company_authority_and_admin_requires_system_manage()
    {
        using var owner = await Register(); using var manager = await Register();
        var first = await Company(owner); var second = await Company(owner); Select(owner, first.Id);
        var multi = await CompanyGroup(owner, "Közös", [first.Id, second.Id], Permissions.VehiclesRead);
        await Join(owner, manager, first.Id, Permissions.GroupsManage, Permissions.Manage, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.Client.PutAsJsonAsync($"/api/v1/permission-groups/{multi.Id}/dashboard", new GroupDashboardInput("Vehicle", 30, multi.Version))).StatusCode);
        var admin = (await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!.Single(x => x.IsAdmin);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{admin.Id}/dashboard", new GroupDashboardInput("Vehicle", 3, admin.Version))).StatusCode);
        await using var db = FleetFixture.CreateContext(fixture.MigrationConnection, new TenantContext());
        db.SystemPermissionGrants.Add(new() { UserId = owner.User.Id, Code = SystemPermissions.Manage });
        await db.SaveChangesAsync();
        var changed = await DashboardGroup(owner, admin, "Overview", 100);
        Assert.Equal(100, changed.DashboardPriority); Assert.True(changed.IsAdmin); Assert.True(changed.AllPermissions);
        Assert.Single(await db.PermissionGroups.Where(x => x.IsAdmin).ToArrayAsync());
        Assert.False(await db.SystemPermissionGrants.AnyAsync(x => x.UserId == manager.User.Id));
    }
    [Fact]
    public async Task Personal_garage_does_not_fall_back_after_release_and_parking_uses_authorized_appearance()
    {
        using var owner = await Register(); using var driver = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Company(foreign);
        await Join(owner, driver, company.Id, Permissions.VehiclesRead);
        var car = await FleetCar(owner, "MINE-001");
        await FleetCar(owner, "OTHER-002");
        var foreignCar = await FleetCar(foreign, "FOREIGN-001");
        car = await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync(CarUrl(car) + "/details", new SaveVehicleRecord(car.Vehicle.Registration, car.Vehicle.Make, car.Vehicle.Model, "Active", car.Vehicle.Version, car.Data with { BodyType = "Estate", Color = "Kék" })));
        await ScopeOk<object>(await owner.Client.PutAsJsonAsync(CarUrl(car) + "/assignee", new { userId = driver.User.Id, version = car.Vehicle.Version }));
        var home = (await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!;
        Assert.Equal(car.Vehicle.Id, Assert.Single(home.Vehicles).Vehicle.Id);
        Assert.True(home.Vehicles[0].IsAssignedToMe);
        var parking = await SearchCars(driver, "pageSize=4");
        Assert.Equal(2, parking.Items.Length);
        var appearance = Assert.Single(parking.Items, x => x.Id == car.Vehicle.Id);
        Assert.Equal("Estate", appearance.BodyType); Assert.Equal("Kék", appearance.Color);
        Assert.DoesNotContain(parking.Items, x => x.Id == foreignCar.Vehicle.Id);
        var current = (await owner.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(car) + "/details"))!;
        await ScopeOk<object>(await owner.Client.PutAsJsonAsync(CarUrl(car) + "/assignee", new { userId = (string?)null, version = current.Vehicle.Version }));
        Assert.Empty((await driver.Client.GetFromJsonAsync<DashboardSummary>("/api/v1/dashboard"))!.Vehicles);
    }

}
