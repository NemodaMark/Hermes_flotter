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
    private static async Task<PermissionGroupSummary> NewGroup(Account actor, string name, params string[] codes)
    {
        var response = await actor.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest(name, codes));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PermissionGroupSummary>())!;
    }
    private static async Task<HttpResponseMessage> Assign(Account actor, string subject, params Guid[] groups)
    {
        var access = await Access(actor, subject);
        return await actor.Client.PutAsJsonAsync($"/api/v1/members/{subject}/groups", new ChangeGroupsRequest(groups, access.Version));
    }

    [Fact]
    public async Task Group_union_direct_grants_and_definition_revocation_apply_to_existing_sessions()
    {
        using var owner = await Register(); using var member = await Register();
        var tenant = await Company(owner);
        await Join(owner, member, tenant.Id, Permissions.MembersRead);
        var reader = await NewGroup(owner, "Olvasó", Permissions.VehiclesRead);
        var recorder = await NewGroup(owner, "Km rögzítő", Permissions.OdometerCreate, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, member.User.Id, reader.Id, recorder.Id)).StatusCode);
        var access = (await member.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!;
        Assert.Equal(new[] { Permissions.OdometerCreate, Permissions.VehiclesRead, Permissions.MembersRead }.Order(), access.Permissions.Order());
        Assert.Equal([Permissions.MembersRead], access.DirectPermissions);
        Assert.Equal(2, access.Groups.Length);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/system/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{reader.Id}", new UpdateGroupRequest("Olvasó", [], reader.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode); // second group still grants read
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, member.User.Id, reader.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal([Permissions.MembersRead], (await member.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!.Permissions);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "group.updated" && x.Details.Contains("before") && x.Details.Contains("after"));
        Assert.Contains(audit.Items, x => x.Action == "member.groups_changed" && x.TargetSubject == member.User.Id);
    }

    [Fact]
    public async Task Admin_expands_from_current_catalog_is_protected_and_is_company_scoped()
    {
        using var owner = await Register(); using var member = await Register();
        var tenant = await Company(owner); await Join(owner, member, tenant.Id);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        Assert.Equal("admin", admin.Name);
        Assert.Equal(Permissions.All.Order(), admin.Permissions.Order());
        Assert.Empty((await Access(owner, owner.User.Id)).DirectPermissions);
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{admin.Id}", new UpdateGroupRequest("Other", [], 1)), HttpStatusCode.Conflict, "protected_admin_group");
        await AssertCode(await owner.Client.DeleteAsync($"/api/v1/permission-groups/{admin.Id}?version=1"), HttpStatusCode.Conflict, "protected_admin_group");
        await AssertCode(await owner.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest(" AdMiN ", [])), HttpStatusCode.Conflict, "protected_admin_group");
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, member.User.Id, admin.Id)).StatusCode);
        Assert.Equal(Permissions.All.Order(), (await member.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!.Permissions.Order());
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/system/users")).StatusCode);
        var other = await Company(owner); Select(member, other.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/permission-groups")).StatusCode);
        var context = new TenantContext(); context.Set(tenant.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await TenantTransaction.RunAsync(db, tenant.Id, async () =>
        {
            // Admin has no fixed snapshot of rights in storage; its rights come from the live catalog.
            Assert.Empty(await db.GroupPermissions.Where(x => x.GroupId == admin.Id).ToArrayAsync());
            return true;
        }, default);
    }

    [Fact]
    public async Task Group_management_and_assignment_are_separate_and_cannot_escalate_privileges()
    {
        using var owner = await Register(); using var editor = await Register(); using var member = await Register();
        var tenant = await Company(owner);
        await Join(owner, editor, tenant.Id, Permissions.GroupsManage, Permissions.VehiclesRead);
        await Join(owner, member, tenant.Id);
        var group = await NewGroup(editor, "Megtekintés", Permissions.VehiclesRead);
        await AssertCode(await editor.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest("Megtekintés", [Permissions.Manage], 1)), HttpStatusCode.Forbidden, "delegation_denied");
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/groups", new ChangeGroupsRequest([group.Id], 1))).StatusCode);
        await AssertCode(await editor.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Rendszer", [SystemPermissions.Manage])), HttpStatusCode.BadRequest, "invalid_permissions");
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, editor.User.Id, Permissions.All)).StatusCode);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        await AssertCode(await Assign(editor, editor.User.Id, admin.Id), HttpStatusCode.Forbidden, "admin_delegation_denied");
        // A user with finite direct grants cannot grant themselves the future-expanding wildcard.
        Assert.Equal(HttpStatusCode.OK, (await Assign(editor, member.User.Id, group.Id)).StatusCode);
    }

    [Fact]
    public async Task Last_inherited_manager_is_protected_during_group_edit_delete_unassignment_and_suspension()
    {
        using var owner = await Register(); using var manager = await Register();
        var tenant = await Company(owner); await Join(owner, manager, tenant.Id, Permissions.GroupsManage, Permissions.MembersUpdate);
        var group = await NewGroup(owner, "Jogkezelés", Permissions.Manage);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, manager.User.Id, group.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, owner.User.Id)).StatusCode);
        await AssertCode(await manager.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest(group.Name, [], 1)), HttpStatusCode.Conflict, "last_permission_manager");
        await AssertCode(await manager.Client.DeleteAsync($"/api/v1/permission-groups/{group.Id}?version=1"), HttpStatusCode.Conflict, "last_permission_manager");
        await AssertCode(await Assign(manager, manager.User.Id), HttpStatusCode.Conflict, "last_permission_manager");
        await AssertCode(await manager.Client.PatchAsJsonAsync($"/api/v1/members/{manager.User.Id}/status", new ChangeMemberStatusRequest(false, 2)), HttpStatusCode.Conflict, "last_permission_manager");
    }

    [Fact]
    public async Task Odometer_only_group_can_record_without_editing_vehicle_and_editor_cannot_record()
    {
        using var owner = await Register(); using var recorder = await Register(); using var editor = await Register();
        var tenant = await Company(owner); await Join(owner, recorder, tenant.Id); await Join(owner, editor, tenant.Id);
        var km = await NewGroup(owner, "Km", Permissions.VehiclesRead, Permissions.OdometerCreate);
        var edit = await NewGroup(owner, "Autóadatok", Permissions.VehiclesRead, Permissions.VehiclesUpdate);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, recorder.User.Id, km.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, editor.User.Id, edit.Id)).StatusCode);
        var created = await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("GROUP-01", "Ford", "Focus"));
        var vehicle = (await created.Content.ReadFromJsonAsync<VehicleSummary>())!;
        Assert.Equal(HttpStatusCode.Forbidden, (await recorder.Client.PutAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}", new UpdateVehicleRequest("GROUP-02", "Ford", "Fiesta", 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.Client.PostAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}/odometer", new RecordOdometerRequest(1000, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await recorder.Client.PostAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}/odometer", new RecordOdometerRequest(1000, 1))).StatusCode);
        foreach (var invalid in new long?[] { null, -1, 100_000_001 })
            await AssertCode(await recorder.Client.PostAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}/odometer", new RecordOdometerRequest(invalid, 2)), HttpStatusCode.BadRequest, "invalid_odometer");
        await AssertCode(await recorder.Client.PostAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}/odometer", new RecordOdometerRequest(900, 2)), HttpStatusCode.BadRequest, "invalid_odometer");
        await AssertCode(await editor.Client.PutAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}", new UpdateVehicleRequest("GROUP-02", "Ford", "Fiesta", 1)), HttpStatusCode.Conflict, "stale_vehicle");
        var updated = await editor.Client.PutAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}", new UpdateVehicleRequest("GROUP-02", "Ford", "Fiesta", 2));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(1000, (await updated.Content.ReadFromJsonAsync<VehicleSummary>())!.OdometerKm);
        var other = await Company(owner); await Join(owner, recorder, other.Id, Permissions.OdometerCreate); Select(recorder, other.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await recorder.Client.PostAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}/odometer", new RecordOdometerRequest(2000, 3))).StatusCode);
        await Join(owner, editor, other.Id, Permissions.VehiclesUpdate);
        Assert.Equal(HttpStatusCode.NotFound, (await editor.Client.PutAsJsonAsync($"/api/v1/vehicles/{vehicle.Id}", new UpdateVehicleRequest("CROSS-01", "Other", "Other", 3))).StatusCode);
        Select(owner, tenant.Id);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "vehicle.odometer_recorded" && x.ActorSubject == recorder.User.Id);
    }

    [Fact]
    public async Task Concurrent_group_edits_cannot_remove_both_remaining_permission_managers()
    {
        using var owner = await Register(); using var first = await Register(); using var second = await Register();
        var tenant = await Company(owner);
        await Join(owner, first, tenant.Id, Permissions.GroupsManage);
        await Join(owner, second, tenant.Id, Permissions.GroupsManage);
        var a = await NewGroup(owner, "Első kezelő", Permissions.Manage);
        var b = await NewGroup(owner, "Második kezelő", Permissions.Manage);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, first.User.Id, a.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, second.User.Id, b.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, owner.User.Id)).StatusCode);
        var responses = await Task.WhenAll(first.Client.PutAsJsonAsync($"/api/v1/permission-groups/{a.Id}", new UpdateGroupRequest(a.Name, [], 1)),
            second.Client.PutAsJsonAsync($"/api/v1/permission-groups/{b.Id}", new UpdateGroupRequest(b.Name, [], 1)));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        await AssertCode(Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "last_permission_manager");
    }

    [Fact]
    public async Task Group_revocation_invalidates_invitation_issuer_and_suspension_disables_group_rights()
    {
        using var owner = await Register(); using var inviter = await Register(); using var recipient = await Register();
        var tenant = await Company(owner); await Join(owner, inviter, tenant.Id);
        var group = await NewGroup(owner, "Meghívók", Permissions.MembersInvite, Permissions.Manage, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, inviter.User.Id, group.Id)).StatusCode);
        var invitation = await Invite(inviter, recipient, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, inviter.User.Id)).StatusCode);
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invitation.Acceptance), HttpStatusCode.Conflict, "inviter_access_changed");
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, inviter.User.Id, group.Id)).StatusCode);
        var access = await Access(owner, inviter.User.Id);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{inviter.User.Id}/status", new ChangeMemberStatusRequest(false, access.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await inviter.Client.GetAsync("/api/v1/vehicles")).StatusCode);
    }

    [Fact]
    public async Task System_manager_reads_own_real_membership_version_and_cannot_lose_global_access_by_group_removal()
    {
        using var owner = await Register(); using var other = await Register();
        var tenant = await Company(owner); await Join(owner, other, tenant.Id, Permissions.Manage);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, owner.User.Id, Permissions.VehiclesRead)).StatusCode);
        await using (var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
        { db.SystemPermissionGrants.Add(new() { UserId = owner.User.Id, Code = SystemPermissions.Manage }); await db.SaveChangesAsync(); }
        var access = await Access(owner, owner.User.Id);
        Assert.Equal(2, access.Version);
        Assert.True(Assert.Single(access.Groups).IsAdmin);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, owner.User.Id)).StatusCode);
        access = await Access(owner, owner.User.Id);
        Assert.Equal(3, access.Version); Assert.Empty(access.Groups);
        Assert.Equal(Permissions.All.Order(), access.Permissions.Order());
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync("/api/v1/system/users")).StatusCode);
    }

    [Fact]
    public async Task Restoring_a_suspended_admin_requires_future_expanding_admin_authority()
    {
        using var owner = await Register(); using var manager = await Register(); using var target = await Register();
        var tenant = await Company(owner);
        await Join(owner, manager, tenant.Id, Permissions.All);
        await Join(owner, target, tenant.Id);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        Assert.Equal(HttpStatusCode.OK, (await Assign(owner, target.User.Id, admin.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(false, 2))).StatusCode);
        await AssertCode(await manager.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(true, 3)), HttpStatusCode.Forbidden, "admin_delegation_denied");
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(true, 3))).StatusCode);
    }

    [Fact]
    public async Task Group_inputs_versions_tenant_isolation_and_database_rls_are_enforced()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); await Join(owner, member, first.Id);
        var group = await NewGroup(owner, "Teszt", Permissions.VehiclesRead);
        await AssertCode(await owner.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest(" teszt ", [])), HttpStatusCode.Conflict, "group_name_exists");
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest("Teszt", [], 99)), HttpStatusCode.Conflict, "stale_group");
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/groups", new ChangeGroupsRequest([group.Id], 99)), HttpStatusCode.Conflict, "stale_group");
        var second = await Company(owner);
        Assert.DoesNotContain((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.Id == group.Id);
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest("Cross", [], 1)), HttpStatusCode.NotFound, "group_not_found");
        await AssertCode(await Assign(owner, owner.User.Id, group.Id), HttpStatusCode.NotFound, "group_not_found");
        var context = new TenantContext(); context.Set(second.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await TenantTransaction.RunAsync(db, second.Id, async () =>
        {
            Assert.DoesNotContain(await db.PermissionGroups.IgnoreQueryFilters().ToArrayAsync(), x => x.Id == group.Id);
            Assert.Empty(await db.GroupPermissions.IgnoreQueryFilters().ToArrayAsync());
            Assert.All(await db.MembershipGroups.IgnoreQueryFilters().ToArrayAsync(), x => Assert.Equal(second.Id, x.TenantId));
            var error = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO tenant_membership_groups (\"TenantId\",\"UserSubject\",\"GroupId\") VALUES ({second.Id},{owner.User.Id},{group.Id})"));
            Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, error.SqlState);
            // Deliberate SQL error aborts this transaction; rollback is exercised separately below.
            return true;
        }, default);
    }
}
