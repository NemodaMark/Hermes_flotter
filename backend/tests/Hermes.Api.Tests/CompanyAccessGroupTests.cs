using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static async Task CompanyJoin(Account actor, Account member, Guid id, params string[] codes)
    { Select(actor, id); await Join(actor, member, id, codes); }
    private static async Task<CompanyAccessGroupSummary> CompanyGroup(Account actor, string name, Guid[] companies, params string[] codes)
    {
        var response = await actor.Client.PostAsJsonAsync("/api/v1/company-access/groups", new CreateCompanyAccessGroupRequest(name, codes, companies));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CompanyAccessGroupSummary>())!;
    }
    private static async Task<HttpResponseMessage> CompanyAssign(Account actor, string userId, params Guid[] ids)
    {
        var state = (await actor.Client.GetFromJsonAsync<CompanyAccessUserSummary>($"/api/v1/company-access/users/{userId}"))!;
        return await actor.Client.PutAsJsonAsync($"/api/v1/company-access/users/{userId}", new AssignCompanyAccessGroupsRequest(ids, state.Version));
    }
    [Fact]
    public async Task Cross_company_group_adds_memberships_and_revokes_only_its_own_access()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        var group = await CompanyGroup(owner, "Két céges olvasó", [first.Id, second.Id], Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        var companies = (await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!;
        Assert.Equal(new[] { first.Id, second.Id }.Order(), companies.Select(x => x.Id).Order());
        Assert.All(companies, x => Assert.Equal([Permissions.VehiclesRead], x.Permissions));
        foreach (var company in companies)
        { Select(member, company.Id); Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode); }
        Select(owner, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id, Permissions.VehiclesRead, Permissions.VehiclesCreate)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id)).StatusCode);
        companies = (await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!;
        Assert.Equal(first.Id, Assert.Single(companies).Id); // Independent grant preserved.
        Select(member, second.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Select(member, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
    }
    [Fact]
    public async Task Editing_company_selection_and_rights_updates_existing_users_and_hides_removed_workspaces()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner); var third = await Company(owner);
        var group = await CompanyGroup(owner, "Mozgó csoport", [first.Id, second.Id], Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        var response = await owner.Client.PutAsJsonAsync($"/api/v1/company-access/groups/{group.Id}", new UpdateCompanyAccessGroupRequest(group.Name, [Permissions.OdometerCreate], [second.Id, third.Id], group.Version));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var companies = (await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!;
        Assert.Equal(new[] { second.Id, third.Id }.Order(), companies.Select(x => x.Id).Order());
        Assert.All(companies, x => Assert.Equal([Permissions.OdometerCreate], x.Permissions));
        Select(member, first.Id); Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Select(owner, second.Id);
        var access = await Access(owner, member.User.Id);
        Assert.True(Assert.Single(access.Groups).IsMultiCompany);
        Assert.Empty(access.DirectPermissions);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "company_group.updated" && x.ActorSubject == owner.User.Id);
        Assert.DoesNotContain(first.Id.ToString(), string.Join("", audit.Items.Where(x => x.Action.StartsWith("company_group.")).Select(x => x.Details))); // No other-company scope leak into tenant audit.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"/api/v1/company-access/groups/{group.Id}?version=2")).StatusCode);
        Assert.Empty((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
        // An expired derived membership can become an independent membership through a fresh invitation.
        await CompanyJoin(owner, member, second.Id, Permissions.VehiclesRead);
        Assert.Equal(second.Id, Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
    }
    [Fact]
    public async Task Company_managers_can_only_select_and_change_companies_within_their_authority()
    {
        using var owner = await Register(); using var manager = await Register(); using var outsider = await Register();
        var first = await Company(owner); var second = await Company(owner);
        await CompanyJoin(owner, manager, first.Id, Permissions.GroupsManage, Permissions.Manage, Permissions.VehiclesRead);
        var choices = (await manager.Client.GetFromJsonAsync<CompanyAccessOption[]>("/api/v1/company-access/companies"))!;
        Assert.Equal(first.Id, Assert.Single(choices).Id);
        var own = await CompanyGroup(manager, "Saját cég", [first.Id], Permissions.VehiclesRead);
        await AssertCode(await manager.Client.PutAsJsonAsync($"/api/v1/company-access/groups/{own.Id}", new UpdateCompanyAccessGroupRequest(own.Name, [Permissions.VehiclesRead], [first.Id, second.Id], 1)), HttpStatusCode.Forbidden, "company_group_permission_denied");
        await AssertCode(await manager.Client.PostAsJsonAsync("/api/v1/company-access/groups", new CreateCompanyAccessGroupRequest("Túl sok jog", [Permissions.VehiclesCreate], [first.Id])), HttpStatusCode.Forbidden, "company_group_permission_denied");
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(manager, outsider.User.Id, own.Id)).StatusCode);
        var foreign = await CompanyGroup(owner, "Idegen cégcsoport", [second.Id], Permissions.VehiclesRead);
        Assert.DoesNotContain((await manager.Client.GetFromJsonAsync<CompanyAccessGroupSummary[]>("/api/v1/company-access/groups"))!, x => x.Id == foreign.Id);
        await AssertCode(await manager.Client.DeleteAsync($"/api/v1/company-access/groups/{foreign.Id}?version=1"), HttpStatusCode.NotFound, "company_group_not_found");
        Assert.Empty((await outsider.Client.GetFromJsonAsync<CompanyAccessOption[]>("/api/v1/company-access/companies"))!);
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.Client.GetAsync($"/api/v1/company-access/users/{owner.User.Id}")).StatusCode);
    }
    [Fact]
    public async Task Unmanaged_group_assignments_are_preserved_during_partial_manager_edits()
    {
        using var owner = await Register(); using var manager = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        await CompanyJoin(owner, manager, first.Id, Permissions.Manage, Permissions.VehiclesRead);
        var shared = await CompanyGroup(owner, "Közös", [first.Id, second.Id], Permissions.VehiclesRead);
        var local = await CompanyGroup(owner, "Egy céges", [first.Id], Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, shared.Id)).StatusCode);
        var visible = (await manager.Client.GetFromJsonAsync<CompanyAccessUserSummary>($"/api/v1/company-access/users/{member.User.Id}"))!;
        Assert.True(visible.HasOtherGroups); Assert.Empty(visible.GroupIds);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(manager, member.User.Id, local.Id)).StatusCode);
        var all = (await owner.Client.GetFromJsonAsync<CompanyAccessUserSummary>($"/api/v1/company-access/users/{member.User.Id}"))!;
        Assert.Equal(new[] { shared.Id, local.Id }.Order(), all.GroupIds.Order());
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(manager, member.User.Id)).StatusCode);
        Assert.Equal(shared.Id, Assert.Single((await owner.Client.GetFromJsonAsync<CompanyAccessUserSummary>($"/api/v1/company-access/users/{member.User.Id}"))!.GroupIds));
        await AssertCode(await CompanyAssign(manager, member.User.Id, shared.Id), HttpStatusCode.Forbidden, "company_group_permission_denied");
    }
    [Fact]
    public async Task Adding_a_group_never_reactivates_a_suspended_company_membership()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        await CompanyJoin(owner, member, first.Id, Permissions.VehiclesRead);
        Select(owner, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new ChangeMemberStatusRequest(false, 1))).StatusCode);
        var group = await CompanyGroup(owner, "Céges tagok", [first.Id, second.Id], Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        Assert.Equal(second.Id, Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        Select(member, first.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Select(owner, first.Id); Assert.False((await Access(owner, member.User.Id)).IsActive);
    }
    [Fact]
    public async Task Last_permission_manager_guards_roll_back_all_companies_atomically()
    {
        using var owner = await Register();
        var first = await Company(owner); var second = await Company(owner);
        var group = await CompanyGroup(owner, "Kezelők", [first.Id, second.Id], Permissions.GroupsManage, Permissions.Manage, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, owner.User.Id, group.Id)).StatusCode);
        foreach (var id in new[] { first.Id, second.Id }) { Select(owner, id); Assert.Equal(HttpStatusCode.OK, (await Assign(owner, owner.User.Id)).StatusCode); }
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/company-access/groups/{group.Id}", new UpdateCompanyAccessGroupRequest(group.Name, [Permissions.GroupsManage, Permissions.VehiclesRead], [first.Id, second.Id], 1)), HttpStatusCode.Conflict, "last_permission_manager");
        await AssertCode(await owner.Client.DeleteAsync($"/api/v1/company-access/groups/{group.Id}?version=1"), HttpStatusCode.Conflict, "last_permission_manager");
        await AssertCode(await CompanyAssign(owner, owner.User.Id), HttpStatusCode.Conflict, "last_permission_manager");
        var current = Assert.Single((await owner.Client.GetFromJsonAsync<CompanyAccessGroupSummary[]>("/api/v1/company-access/groups"))!);
        Assert.Equal(1, current.Version); Assert.Contains(Permissions.Manage, current.Permissions);
        foreach (var id in new[] { first.Id, second.Id }) { Select(owner, id); Assert.Contains(Permissions.Manage, (await owner.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!.Permissions); }
    }
    [Fact]
    public async Task Future_expanding_groups_require_admin_authority_in_every_selected_company()
    {
        using var owner = await Register(); using var manager = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        await CompanyJoin(owner, manager, first.Id, Permissions.All); await CompanyJoin(owner, manager, second.Id, Permissions.All);
        var request = new CreateCompanyAccessGroupRequest("Többcéges admin", [], [first.Id, second.Id], AllPermissions: true);
        await AssertCode(await manager.Client.PostAsJsonAsync("/api/v1/company-access/groups", request), HttpStatusCode.Forbidden, "company_group_permission_denied");
        var response = await owner.Client.PostAsJsonAsync("/api/v1/company-access/groups", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var group = (await response.Content.ReadFromJsonAsync<CompanyAccessGroupSummary>())!;
        Assert.Equal(Permissions.All.Order(), group.Permissions.Order());
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/system/users")).StatusCode);
        Assert.All((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!, x => Assert.Equal(Permissions.All.Order(), x.Permissions.Order()));
    }
    [Fact]
    public async Task Cross_company_odometer_permissions_are_enforced_for_real_vehicle_writes()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        var group = await CompanyGroup(owner, "Közös km-rögzítők", [first.Id, second.Id], Permissions.VehiclesRead, Permissions.OdometerCreate);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        foreach (var id in new[] { first.Id, second.Id })
        {
            Select(owner, id); Select(member, id);
            var response = await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("MULTI-01", "Ford", "Focus"));
            var vehicle = (await response.Content.ReadFromJsonAsync<VehicleSummary>())!;
            Assert.Equal(HttpStatusCode.OK, (await member.Client.PostAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}/odometer", new RecordOdometerRequest(12345, vehicle.Version))).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}", new UpdateVehicleRequest("DENIED", "Other", "Other", 2))).StatusCode);
        }
    }

    [Fact]
    public async Task Concurrent_company_group_updates_preserve_the_winning_definition_and_membership_effects()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        var group = await CompanyGroup(owner, "Versenyző módosítások", [first.Id], Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        var responses = await Task.WhenAll(
            owner.Client.PutAsJsonAsync($"/api/v1/company-access/groups/{group.Id}", new UpdateCompanyAccessGroupRequest(group.Name, [Permissions.VehiclesRead], [second.Id], 1)),
            owner.Client.PutAsJsonAsync($"/api/v1/company-access/groups/{group.Id}", new UpdateCompanyAccessGroupRequest(group.Name, [Permissions.OdometerCreate], [first.Id], 1)));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        await AssertCode(Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "stale_company_group");
        var winner = (await Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK).Content.ReadFromJsonAsync<CompanyAccessGroupSummary>())!;
        var actual = Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
        Assert.Equal(Assert.Single(winner.Companies).Id, actual.Id);
        Assert.Equal(winner.Permissions, actual.Permissions);
    }

    [Fact]
    public async Task Cross_company_inputs_conflicts_and_projection_rls_are_enforced()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner);
        foreach (var ids in new Guid[]?[] { null, [], [first.Id, first.Id], [Guid.Empty] })
            await AssertCode(await owner.Client.PostAsJsonAsync("/api/v1/company-access/groups", new CreateCompanyAccessGroupRequest("Hibás", [], ids!)), HttpStatusCode.BadRequest, "invalid_companies");
        var group = await CompanyGroup(owner, "Verziózott", [first.Id], Permissions.VehiclesRead);
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/company-access/groups/{group.Id}", new UpdateCompanyAccessGroupRequest(group.Name, [], [first.Id], 99)), HttpStatusCode.Conflict, "stale_company_group");
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/company-access/users/{member.User.Id}", new AssignCompanyAccessGroupsRequest([group.Id], 99)), HttpStatusCode.Conflict, "stale_company_group");
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, group.Id)).StatusCode);
        var context = new TenantContext(); context.Set(second.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await TenantTransaction.RunAsync(db, second.Id, async () =>
        {
            Assert.Empty(await db.CompanyAccessMemberships.IgnoreQueryFilters().ToArrayAsync());
            await db.Database.CurrentTransaction!.CreateSavepointAsync("forged");
            var error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO company_access_memberships (\"TenantId\",\"UserSubject\",\"GroupId\") VALUES ({second.Id},{owner.User.Id},{group.Id})"));
            Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, error.SqlState);
            await db.Database.CurrentTransaction.RollbackToSavepointAsync("forged");
            error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO company_access_memberships (\"TenantId\",\"UserSubject\",\"GroupId\") VALUES ({first.Id},{owner.User.Id},{group.Id})"));
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, error.SqlState);
            await db.Database.CurrentTransaction.RollbackToSavepointAsync("forged");
            return true;
        }, default);
    }
}
