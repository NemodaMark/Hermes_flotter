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
    private static async Task<PermissionGroupSummary> DashboardGroup(Account owner, PermissionGroupSummary group, string mode, int priority)
        => await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}/dashboard", new GroupDashboardInput(mode, priority, group.Version)));

    [Fact]
    public async Task Dashboard_priority_is_company_specific_ties_fall_back_and_changes_are_fresh_and_audited()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner); Select(owner, first.Id);
        await Join(owner, member, first.Id, Permissions.VehiclesRead);
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
        var car = Assert.Single(dashboard.Vehicles);
        Assert.Equal("Vehicle", dashboard.Mode); Assert.Equal(carA.Id, car.Vehicle.Id); Assert.False(car.IsAssignedToMe);
        Assert.DoesNotContain(Permissions.OdometerCreate, car.Vehicle.Permissions);
        Assert.DoesNotContain(dashboard.Vehicles, x => x.Vehicle.Id == carB.Id || x.Vehicle.Id == none.Id);
        Select(stranger, company.Id); Assert.Equal(HttpStatusCode.Forbidden, (await stranger.Client.GetAsync("/api/v1/dashboard")).StatusCode);
        Select(owner, company.Id);
        var access = await Access(owner, member.User.Id);
        await owner.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { isActive = false, version = access.Version });
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/dashboard")).StatusCode);
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
}
