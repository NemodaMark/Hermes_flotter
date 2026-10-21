using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    [Fact]
    public async Task Assignment_history_preserves_periods_and_both_actors_after_transfer_release_and_archive()
    {
        using var owner = await Register(); using var first = await Register(); using var second = await Register();
        using var assigner = await Register(); using var reader = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Company(foreign);
        await Join(owner, first, company.Id); await Join(owner, second, company.Id);
        await Join(owner, assigner, company.Id, Permissions.VehiclesAssignUsers);
        await Join(owner, reader, company.Id, Permissions.VehiclesRead);
        var car = await ScopeCar(owner, "USER-HISTORY"); var path = $"/api/v1/vehicles/{car.Id}/assignee-history";
        Assert.Empty((await reader.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(path))!.Items);
        await ScopeOk<JsonElement>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}/assignee", new AssignUserInput(first.User.Id, car.Version)));
        await ScopeOk<JsonElement>(await assigner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}/assignee", new AssignUserInput(second.User.Id, car.Version + 1)));
        var history = (await reader.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(path))!;
        Assert.Equal(2, history.Total);
        var active = history.Items[0]; var previous = history.Items[1];
        Assert.Equal(second.User.Id, active.UserId); Assert.Equal(second.User.DisplayName, active.DisplayName);
        Assert.Equal(assigner.User.Id, active.AssignedBy); Assert.Equal(assigner.User.DisplayName, active.AssignedByDisplayName);
        Assert.Null(active.ReleasedAt); Assert.Null(active.ReleasedBy);
        Assert.Equal(first.User.Id, previous.UserId); Assert.Equal(owner.User.Id, previous.AssignedBy);
        Assert.Equal(assigner.User.Id, previous.ReleasedBy); Assert.Equal(assigner.User.DisplayName, previous.ReleasedByDisplayName);
        Assert.Equal(active.AssignedAt, previous.ReleasedAt);
        Assert.True(previous.AssignedAt <= previous.ReleasedAt);
        await ScopeOk<JsonElement>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}/assignee", new AssignUserInput(null, car.Version + 2)));
        // Repeating an unchanged selection must not invent another historical period.
        await ScopeOk<JsonElement>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}/assignee", new AssignUserInput(null, car.Version + 3)));
        var member = await Access(owner, first.User.Id);
        await ScopeOk<TenantAccess>(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{first.User.Id}/status", new { isActive = false, member.Version }));
        await ScopeOk<VehicleRecord>(await owner.Client.PatchAsJsonAsync($"/api/v1/vehicles/{car.Id}/status", new ChangeArchiveStatus(true, "Historical vehicle", car.Version + 3)));
        history = (await reader.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(path))!;
        Assert.Equal(2, history.Total); Assert.All(history.Items, row => Assert.NotNull(row.ReleasedAt));
        Assert.Equal(owner.User.Id, history.Items[0].ReleasedBy);
        Assert.Equal(first.User.DisplayName, history.Items[1].DisplayName);
        Assert.Equal(HttpStatusCode.BadRequest, (await reader.Client.GetAsync(path + "?page=0")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await assigner.Client.GetAsync(path)).StatusCode);
        var json = await reader.Client.GetStringAsync(path);
        Assert.DoesNotContain("email", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("systemPermissions", json);
    }

    [Fact]
    public async Task Assignment_history_uses_the_read_permissions_own_site_scope_and_hides_unassigned_cars()
    {
        using var owner = await Register(); using var reader = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "HISTORY-A"); var b = await ScopeSite(owner, "HISTORY-B");
        var carA = await ScopeCar(owner, "HISTORY-A", a.Id); var carB = await ScopeCar(owner, "HISTORY-B", b.Id);
        var unassigned = await ScopeCar(owner, "HISTORY-NONE");
        foreach (var car in new[] { carA, carB, unassigned })
            await ScopeOk<JsonElement>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{car.Id}/assignee", new AssignUserInput(owner.User.Id, car.Version)));
        var readA = await ScopedGroup(owner, "Read history A", company.Id, [a.Id], Permissions.VehiclesRead);
        var assignB = await ScopedGroup(owner, "Assign B only", company.Id, [b.Id], Permissions.VehiclesAssignUsers);
        await CompanyAssign(owner, reader.User.Id, readA.Id, assignB.Id); Select(reader, company.Id);
        Assert.Single((await reader.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>($"/api/v1/vehicles/{carA.Id}/assignee-history"))!.Items);
        Assert.Equal(HttpStatusCode.NotFound, (await reader.Client.GetAsync($"/api/v1/vehicles/{carB.Id}/assignee-history")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await reader.Client.GetAsync($"/api/v1/vehicles/{unassigned.Id}/assignee-history")).StatusCode);
        var member = await Access(owner, reader.User.Id);
        await ScopeOk<TenantAccess>(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{reader.User.Id}/status", new { isActive = false, member.Version }));
        Assert.Equal(HttpStatusCode.Forbidden, (await reader.Client.GetAsync($"/api/v1/vehicles/{carA.Id}/assignee-history")).StatusCode);
    }

    [Fact]
    public async Task Assignment_history_has_stable_paging_and_keeps_usernames_for_missing_actor_profiles()
    {
        using var owner = await Register(); var company = await Company(owner); var car = await ScopeCar(owner, "PAGED-HISTORY");
        var context = new TenantContext(); context.Set(company.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        var when = DateTimeOffset.Parse("2026-10-01T08:00:00Z");
        await TenantTransaction.RunAsync(db, company.Id, async () =>
        {
            for (var i = 0; i < 26; i++) db.VehicleUserAssignments.Add(new() { TenantId = company.Id, VehicleId = car.Id,
                Id = Guid.Parse($"00000000-0000-4000-8000-{i.ToString("D12")}"), UserId = owner.User.Id,
                AssignedBy = "former.operator", AssignedAt = when, ReleasedBy = "former.operator", ReleasedAt = when.AddHours(1) });
            return await db.SaveChangesAsync();
        }, default);
        var path = $"/api/v1/vehicles/{car.Id}/assignee-history";
        var first = (await owner.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(path))!;
        var last = (await owner.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(path + "?page=2"))!;
        Assert.Equal(26, first.Total); Assert.Equal(25, first.Items.Length); Assert.Equal(25, first.PageSize);
        Assert.Equal(Guid.Parse("00000000-0000-4000-8000-000000000025"), first.Items[0].Id);
        var row = Assert.Single(last.Items); Assert.DoesNotContain(first.Items, x => x.Id == row.Id);
        Assert.Equal("former.operator", row.AssignedByDisplayName); Assert.Equal("former.operator", row.ReleasedByDisplayName);
        Assert.Empty((await owner.Client.GetFromJsonAsync<PageResult<VehicleAssignmentHistory>>(path + "?page=3"))!.Items);
    }
}
