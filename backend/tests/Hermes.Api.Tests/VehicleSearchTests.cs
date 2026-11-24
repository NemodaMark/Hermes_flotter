using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static async Task<VehicleListPage> SearchCars(Account actor, string query = "") =>
        await ScopeOk<VehicleListPage>(await actor.Client.GetAsync("/api/v1/vehicles/search" + (query.Length == 0 ? "" : "?" + query)));

    [Fact]
    public async Task Vehicle_search_pages_are_bounded_ordered_and_do_not_duplicate_rows()
    {
        using var owner = await Register();
        await Company(owner);
        for (var i = 31; i >= 1; i--) await ScopeCar(owner, $"PAGE-{i:000}");
        var first = await SearchCars(owner);
        var last = await SearchCars(owner, "page=2");
        Assert.Equal(31, first.Total);
        Assert.Equal(31, first.AvailableTotal);
        Assert.Equal(25, first.PageSize);
        Assert.Equal(25, first.Items.Length);
        var blankSearch = await SearchCars(owner, "search=%20%20");
        Assert.Equal(first.Total, blankSearch.Total);
        Assert.Equal(first.AvailableTotal, blankSearch.AvailableTotal);
        Assert.Equal(first.Items.Select(x => x.Id), blankSearch.Items.Select(x => x.Id));
        Assert.Equal(6, last.Items.Length);
        Assert.Equal("PAGE-001", first.Items[0].Registration);
        Assert.Equal("PAGE-025", first.Items[^1].Registration);
        Assert.Equal("PAGE-026", last.Items[0].Registration);
        Assert.Equal("PAGE-031", last.Items[^1].Registration);
        Assert.Empty(first.Items.Select(x => x.Id).Intersect(last.Items.Select(x => x.Id)));
        var clamped = await SearchCars(owner, "page=2147483647&pageSize=10");
        Assert.Equal(4, clamped.Page);
        Assert.Equal("PAGE-031", Assert.Single(clamped.Items).Registration);
        Assert.Equal(31, (await SearchCars(owner, "pageSize=100")).Items.Length);
    }

    [Fact]
    public async Task Vehicle_search_matches_current_and_historical_plates_without_history_duplicates()
    {
        using var owner = await Register();
        await Company(owner);
        var car = await ScopeCar(owner, "HISTORY-001");
        car = await ScopeOk<VehicleSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}", new UpdateVehicleRequest("HISTORY-002", "Ford", "Focus", car.Version)));
        car = await ScopeOk<VehicleSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}", new UpdateVehicleRequest("CURRENT-003", "Ford", "Focus", car.Version)));
        foreach (var text in new[] { "history-001", "HISTORY", "current-003", "ford", "focus", "Ford Focus" })
        {
            var page = await SearchCars(owner, "search=" + Uri.EscapeDataString(text));
            Assert.Equal(1, page.Total);
            Assert.Equal(car.Id, Assert.Single(page.Items).Id);
            Assert.Contains("HISTORY-001", page.Items[0].PreviousRegistrations);
            Assert.Equal("CURRENT-003", page.Items[0].Registration);
        }
    }

    [Fact]
    public async Task Vehicle_search_handles_accented_case_and_treats_pattern_characters_literally()
    {
        using var owner = await Register();
        await Company(owner);
        var accent = await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("HU-001", "Škoda", "ÁRVÍZTŰRŐ")));
        var special = await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("HU-002", "Ford", "100%_Pro\\Edition")));
        foreach (var text in new[] { "árvíztűrő", "škoda", "  HU-001  " })
            Assert.Equal(accent.Id, Assert.Single((await SearchCars(owner, "search=" + Uri.EscapeDataString(text))).Items).Id);
        foreach (var text in new[] { "%", "_", "\\", "%_Pro\\" })
        {
            var page = await SearchCars(owner, "search=" + Uri.EscapeDataString(text));
            Assert.Equal(1, page.Total);
            Assert.Equal(special.Id, Assert.Single(page.Items).Id);
        }
        var empty = await SearchCars(owner, "search=missing&page=99");
        Assert.Equal(0, empty.Total);
        Assert.Equal(2, empty.AvailableTotal);
        Assert.Equal(1, empty.Page);
        Assert.Empty(empty.Items);
    }

    [Fact]
    public async Task Vehicle_search_combines_status_and_site_filters_and_preserves_archived_read_access()
    {
        using var owner = await Register();
        await Company(owner);
        var a = await ScopeSite(owner, "A");
        var b = await ScopeSite(owner, "B");
        var active = await ScopeCar(owner, "FILTER-A", a.Id);
        var maintenance = await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("FILTER-M", "Ford", "Transit", a.Id, Status: "Maintenance")));
        await ScopeCar(owner, "FILTER-B", b.Id);
        var unassigned = await ScopeCar(owner, "FILTER-NONE");
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/vehicles/{active.Id}/status", new VehicleStateInput(true, "Kivonás", active.Version))).StatusCode);
        var filtered = await SearchCars(owner, $"siteId={a.Id}&status=Maintenance&search=filter");
        Assert.Equal(4, filtered.AvailableTotal);
        Assert.Equal(1, filtered.Total);
        var row = Assert.Single(filtered.Items);
        Assert.Equal(maintenance.Id, row.Id);
        Assert.Equal(a.Id, row.SiteId);
        Assert.Equal("A", row.SiteName);
        Assert.Equal(unassigned.Id, Assert.Single((await SearchCars(owner, "siteId=none")).Items).Id);
        Assert.Equal(active.Id, Assert.Single((await SearchCars(owner, "status=Archived")).Items).Id);
        Assert.Equal(4, (await SearchCars(owner)).Total);
        Assert.Equal(0, (await SearchCars(owner, $"siteId={b.Id}&status=Maintenance")).Total);
    }

    [Fact]
    public async Task Vehicle_search_counts_and_filters_never_widen_the_read_scope_or_cross_company_boundaries()
    {
        using var owner = await Register(); using var member = await Register(); using var foreign = await Register();
        var company = await Company(owner);
        var a = await ScopeSite(owner, "READ"); var b = await ScopeSite(owner, "EDIT");
        var visible = await ScopeCar(owner, "VISIBLE", a.Id);
        await ScopeCar(owner, "HIDDEN-B", b.Id); await ScopeCar(owner, "HIDDEN-NONE");
        var foreignCompany = await Company(foreign);
        var foreignSite = await ScopeSite(foreign, "FOREIGN");
        await ScopeCar(foreign, "HIDDEN-FOREIGN", foreignSite.Id);
        var read = await ScopedGroup(owner, "A olvasó", company.Id, [a.Id], Permissions.VehiclesRead);
        var edit = await ScopedGroup(owner, "B szerkesztő", company.Id, [b.Id], Permissions.VehiclesUpdate);
        await CompanyAssign(owner, member.User.Id, read.Id, edit.Id); Select(member, company.Id);
        var page = await SearchCars(member, "pageSize=1");
        Assert.Equal(1, page.Total); Assert.Equal(1, page.AvailableTotal);
        Assert.Equal(visible.Id, Assert.Single(page.Items).Id);
        Assert.DoesNotContain(Permissions.VehiclesUpdate, page.Items[0].Permissions);
        foreach (var query in new[] { "search=HIDDEN", $"siteId={b.Id}", $"siteId={foreignSite.Id}", "siteId=none" })
        {
            var empty = await SearchCars(member, query);
            Assert.Empty(empty.Items); Assert.Equal(0, empty.Total); Assert.Equal(1, empty.AvailableTotal);
        }
        Select(member, foreignCompany.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles/search")).StatusCode);
        Select(member, company.Id);
        // A direct read grant adds full-company access, without extending edit rights.
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id, Permissions.VehiclesRead)).StatusCode);
        Assert.Equal(3, (await SearchCars(member)).Total);
        Assert.Single((await SearchCars(member, "siteId=none")).Items);
    }

    [Fact]
    public async Task Vehicle_search_rechecks_scope_changes_and_requires_the_read_operation()
    {
        using var owner = await Register(); using var member = await Register(); using var creator = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var oldCar = await ScopeCar(owner, "BEFORE", a.Id); var newCar = await ScopeCar(owner, "AFTER", b.Id);
        var read = await ScopedGroup(owner, "Változó olvasó", company.Id, [a.Id], Permissions.VehiclesRead);
        await CompanyAssign(owner, member.User.Id, read.Id); Select(member, company.Id);
        Assert.Equal(oldCar.Id, Assert.Single((await SearchCars(member)).Items).Id);
        await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{read.Id}",
            new UpdateGroupRequest(read.Name, read.Permissions, [company.Id], read.Version, SiteScopes: [new(company.Id, false, [b.Id])])));
        Assert.Equal(newCar.Id, Assert.Single((await SearchCars(member)).Items).Id);
        Assert.Empty((await SearchCars(member, "search=BEFORE")).Items);
        var create = await ScopedGroup(owner, "Csak felvitel", company.Id, [a.Id], Permissions.VehiclesCreate);
        await CompanyAssign(owner, creator.User.Id, create.Id); Select(creator, company.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await creator.Client.GetAsync("/api/v1/vehicles/search")).StatusCode);
        using var anonymous = await fixture.ClientAsync(null);
        anonymous.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/vehicles/search")).StatusCode);
        using var unscoped = await fixture.ClientAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await unscoped.GetAsync("/api/v1/vehicles/search")).StatusCode);
    }

    [Theory]
    [InlineData("page=0")]
    [InlineData("page=-1")]
    [InlineData("pageSize=0")]
    [InlineData("pageSize=101")]
    [InlineData("page=abc")]
    [InlineData("status=unknown")]
    [InlineData("status=999")]
    [InlineData("status=1")]
    [InlineData("siteId=unknown")]
    [InlineData("siteId=00000000-0000-0000-0000-000000000000")]
    public async Task Vehicle_search_rejects_invalid_queries(string query)
    {
        using var client = await fixture.ClientAsync("anna", TestFleetData.DunaId);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/vehicles/search?" + query)).StatusCode);
    }

    [Fact]
    public async Task Vehicle_search_rejects_overlong_search_text()
    {
        using var client = await fixture.ClientAsync("anna", TestFleetData.DunaId);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/v1/vehicles/search?search=" + new string('x', 201))).StatusCode);
    }
}
