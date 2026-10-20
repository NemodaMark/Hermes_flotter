using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static async Task<HttpResponseMessage> AdminAssignment(Account actor, string target, params Guid[] companies)
    {
        var admin = Assert.Single((await actor.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        var state = (await actor.Client.GetFromJsonAsync<GroupUserSummary>($"/api/v1/permission-groups/users/{target}"))!;
        return await actor.Client.PutAsJsonAsync($"/api/v1/permission-groups/users/{target}",
            new AssignGroupsRequest(companies.Length > 0 ? [admin.Id] : [], state.Version, companies));
    }

    [Fact]
    public async Task New_companies_reuse_admin_without_extending_existing_users_admin_scope()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        Assert.False(admin.CanEdit); Assert.True(admin.CanAssign);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, member.User.Id, first.Id)).StatusCode);
        var second = await Company(owner);
        var updated = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        Assert.Equal(admin.Id, updated.Id);
        Assert.Equal(2, updated.Companies.Length);
        Assert.Equal(first.Id, Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
        Select(member, second.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/tenant/access")).StatusCode);
    }

    [Fact]
    public async Task Partial_admin_scope_edits_preserve_foreign_scopes_and_other_users()
    {
        using var owner = await Register(); using var manager = await Register(); using var member = await Register(); using var other = await Register();
        var first = await Company(owner); var second = await Company(owner);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, manager.User.Id, first.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, member.User.Id, first.Id, second.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, other.User.Id, first.Id, second.Id)).StatusCode);
        var visible = (await manager.Client.GetFromJsonAsync<GroupUserSummary>($"/api/v1/permission-groups/users/{member.User.Id}"))!;
        Assert.Equal([first.Id], visible.AdminCompanyIds); Assert.True(visible.HasOtherGroups);
        var admin = Assert.Single((await manager.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        Assert.Equal(first.Id, Assert.Single(admin.Companies).Id);
        await AssertCode(await AdminAssignment(manager, member.User.Id, second.Id), HttpStatusCode.Forbidden, "group_permission_denied");
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(manager, member.User.Id)).StatusCode);
        var full = (await owner.Client.GetFromJsonAsync<GroupUserSummary>($"/api/v1/permission-groups/users/{member.User.Id}"))!;
        Assert.Equal([second.Id], full.AdminCompanyIds);
        Assert.Equal(second.Id, Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
        Assert.Equal(2, (await other.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!.Length);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(manager, member.User.Id, first.Id)).StatusCode);
        Assert.Equal(2, (await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!.Length);
    }

    [Fact]
    public async Task Scoped_admin_reassignment_never_reactivates_suspended_company_membership()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var second = await Company(owner); Select(owner, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, member.User.Id, first.Id, second.Id)).StatusCode);
        var access = await Access(owner, member.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new ChangeMemberStatusRequest(false, access.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, member.User.Id, second.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AdminAssignment(owner, member.User.Id, first.Id, second.Id)).StatusCode);
        Assert.False((await Access(owner, member.User.Id)).IsActive);
        Assert.Equal(second.Id, Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "group.admin_companies_changed" && x.ActorSubject == owner.User.Id && x.Details.Contains(member.User.Id));
    }

    [Fact]
    public async Task Admin_selection_requires_explicit_valid_company_scope_and_cannot_be_granted_by_finite_direct_rights()
    {
        using var owner = await Register(); using var manager = await Register(); using var target = await Register();
        var company = await Company(owner); await Join(owner, manager, company.Id, Permissions.All);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        var state = (await owner.Client.GetFromJsonAsync<GroupUserSummary>($"/api/v1/permission-groups/users/{target.User.Id}"))!;
        foreach (var ids in new Guid[]?[] { null, [], [company.Id, company.Id], [Guid.Empty] })
            await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/users/{target.User.Id}", new AssignGroupsRequest([admin.Id], state.Version, ids)), HttpStatusCode.BadRequest, "invalid_admin_companies");
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/users/{target.User.Id}", new AssignGroupsRequest([], state.Version, [company.Id])), HttpStatusCode.BadRequest, "invalid_admin_companies");
        await AssertCode(await AdminAssignment(manager, target.User.Id, company.Id), HttpStatusCode.Forbidden, "group_permission_denied");
        Assert.Empty((await target.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
    }

    [Fact]
    public async Task Concurrent_admin_scope_edits_have_one_winner_and_preserve_the_winning_scope()
    {
        using var owner = await Register(); using var target = await Register();
        var first = await Company(owner); var second = await Company(owner);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        var state = (await owner.Client.GetFromJsonAsync<GroupUserSummary>($"/api/v1/permission-groups/users/{target.User.Id}"))!;
        var responses = await Task.WhenAll(
            owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/users/{target.User.Id}", new AssignGroupsRequest([admin.Id], state.Version, [first.Id])),
            owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/users/{target.User.Id}", new AssignGroupsRequest([admin.Id], state.Version, [second.Id])));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        await AssertCode(Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "stale_group");
        var winner = (await responses.Single(x => x.StatusCode == HttpStatusCode.OK).Content.ReadFromJsonAsync<GroupUserSummary>())!;
        Assert.Equal(Assert.Single(winner.AdminCompanyIds), Assert.Single((await target.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
    }
}
