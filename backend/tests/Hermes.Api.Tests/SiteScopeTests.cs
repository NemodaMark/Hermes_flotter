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
    private static async Task<T> ScopeOk<T>(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }
    private static async Task<SiteDetails> ScopeSite(Account owner, string code) => await ScopeOk<SiteDetails>(
        await owner.Client.PostAsJsonAsync("/api/v1/company/sites", new SiteInput(code, code, new("HU", null, null, null, null), null, null, null)));
    private static async Task<VehicleSummary> ScopeCar(Account owner, string plate, Guid? site = null) =>
        await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest(plate, "Ford", "Focus", site)));
    private static Task<PermissionGroupSummary> ScopedGroup(Account owner, string name, Guid company, Guid[] sites, params string[] codes) =>
        ScopedGroup(owner, name, [new(company, false, sites)], codes);
    private static async Task<PermissionGroupSummary> ScopedGroup(Account owner, string name, GroupSiteSelection[] scopes, params string[] codes) =>
        await ScopeOk<PermissionGroupSummary>(await owner.Client.PostAsJsonAsync("/api/v1/permission-groups",
            new CreateGroupRequest(name, codes, scopes.Select(x => x.CompanyId).ToArray(), SiteScopes: scopes)));

    [Fact]
    public async Task Site_scopes_apply_per_permission_without_cross_multiplying_group_rights_and_sites()
    {
        using var owner = await Register(); using var member = await Register(); using var foreign = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "BP"); var b = await ScopeSite(owner, "GYOR"); var c = await ScopeSite(owner, "PECS");
        var carA = await ScopeCar(owner, "SCOPE-A", a.Id); var carB = await ScopeCar(owner, "SCOPE-B", b.Id); var noSite = await ScopeCar(owner, "SCOPE-NONE");
        var foreignCompany = await Company(foreign); var foreignCar = await ScopeCar(foreign, "FOREIGN");
        var editA = await ScopedGroup(owner, "A szerkesztő", company.Id, [a.Id], Permissions.VehiclesRead, Permissions.VehiclesUpdate, Permissions.SitesRead);
        var odoB = await ScopedGroup(owner, "B kilométer", company.Id, [b.Id], Permissions.VehiclesRead, Permissions.OdometerCreate, Permissions.SitesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(owner, member.User.Id, editA.Id, odoB.Id)).StatusCode);
        Select(member, company.Id);
        var visible = (await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!;
        Assert.Equal(new[] { carA.Id, carB.Id }.Order(), visible.Select(x => x.Id).Order());
        Assert.Contains(Permissions.VehiclesUpdate, visible.Single(x => x.Id == carA.Id).Permissions);
        Assert.DoesNotContain(Permissions.OdometerCreate, visible.Single(x => x.Id == carA.Id).Permissions);
        Assert.DoesNotContain(Permissions.VehiclesUpdate, visible.Single(x => x.Id == carB.Id).Permissions);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/vehicles/{noSite.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/vehicles/{foreignCar.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PutAsJsonAsync($"/api/v1/vehicles/{carB.Id}", new UpdateVehicleRequest("FORGED", "Ford", "Focus", carB.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PostAsJsonAsync($"/api/v1/vehicles/{carA.Id}/odometer", new RecordOdometerRequest(12, carA.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PutAsJsonAsync($"/api/v1/vehicles/{carA.Id}", new UpdateVehicleRequest("SCOPE-A", "Ford", "Updated", carA.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PostAsJsonAsync($"/api/v1/vehicles/{carB.Id}/odometer", new RecordOdometerRequest(12, carB.Version))).StatusCode);
        var sites = (await member.Client.GetFromJsonAsync<SiteDetails[]>("/api/v1/company/sites"))!;
        Assert.Equal(new[] { a.Id, b.Id }.Order(), sites.Select(x => x.Id).Order()); Assert.DoesNotContain(sites, x => x.Id == c.Id);
        Assert.Equal(2, (await member.Client.GetFromJsonAsync<SiteVehicle[]>("/api/v1/company/vehicles"))!.Length);
        Select(member, foreignCompany.Id); Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
    }

    [Fact]
    public async Task Editing_scopes_revokes_access_immediately_and_an_older_client_cannot_silently_remove_the_restriction()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var carA = await ScopeCar(owner, "EDIT-A", a.Id); var carB = await ScopeCar(owner, "EDIT-B", b.Id);
        var group = await ScopedGroup(owner, "Mozgó telephely", company.Id, [a.Id], Permissions.VehiclesRead);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        Assert.Equal(carA.Id, Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Id);
        var changed = await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}",
            new UpdateGroupRequest(group.Name, group.Permissions, [company.Id], group.Version, SiteScopes: [new(company.Id, false, [b.Id])])));
        Assert.Equal(carB.Id, Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Id);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/vehicles/{carA.Id}")).StatusCode);
        var preserved = await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest("Új név", group.Permissions, [company.Id], changed.Version)));
        Assert.False(Assert.Single(preserved.Companies).AllSites); Assert.Equal(b.Id, Assert.Single(preserved.Companies[0].Sites).Id);
        var history = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!.Items;
        Assert.Contains(history, x => x.Action == "group.updated" && x.Details.Contains(a.Id.ToString()) && x.Details.Contains(b.Id.ToString()));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest(group.Name, group.Permissions, [company.Id], 1))).StatusCode);
    }

    [Fact]
    public async Task Independent_direct_and_full_company_admin_grants_remain_additive_and_include_unassigned_vehicles()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); var site = await ScopeSite(owner, "ONLY");
        var allowed = await ScopeCar(owner, "DIRECT-A", site.Id); var unassigned = await ScopeCar(owner, "DIRECT-NONE");
        var group = await ScopedGroup(owner, "Szűk olvasó", company.Id, [site.Id], Permissions.VehiclesRead, Permissions.VehiclesUpdate);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        Assert.Equal(allowed.Id, Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Id);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id, Permissions.VehiclesRead)).StatusCode);
        Assert.Equal(2, (await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!.Length);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PutAsJsonAsync($"/api/v1/vehicles/{unassigned.Id}", new UpdateVehicleRequest("BAD", "Ford", "Focus", 1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id)).StatusCode);
        Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        await CompanyAssign(owner, member.User.Id, admin.Id);
        Assert.Equal(2, (await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!.Length);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PutAsJsonAsync($"/api/v1/vehicles/{unassigned.Id}", new UpdateVehicleRequest("DIRECT-NONE", "Ford", "Admin edit", 1))).StatusCode);
    }

    [Fact]
    public async Task Create_only_scope_requires_an_authorized_active_site_and_creates_the_assignment_atomically()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var group = await ScopedGroup(owner, "Csak felvétel", company.Id, [a.Id], Permissions.VehiclesCreate);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        var options = (await member.Client.GetFromJsonAsync<VehicleCreationOptions>("/api/v1/vehicles/create-options"))!;
        Assert.False(options.CanCreateUnassigned); Assert.Equal(a.Id, Assert.Single(options.Sites).Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("NO-SITE", "Ford", "Focus"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("BAD-SITE", "Ford", "Focus", b.Id))).StatusCode);
        var created = await ScopeCar(member, "ALLOWED", a.Id); Assert.Equal(a.Id, created.SiteId);
        Assert.Equal(a.Id, (await owner.Client.GetFromJsonAsync<VehicleSummary>($"/api/v1/vehicles/{created.Id}"))!.SiteId);
        var archived = await ScopeOk<SiteDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/company/sites/{b.Id}/status", new ChangeArchiveStatus(true, "Bezárás", 1)));
        Assert.True(archived.IsArchived);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("ARCHIVED", "Ford", "Focus", b.Id))).StatusCode);
    }

    [Fact]
    public async Task Reassignment_requires_both_source_and_target_scope_and_never_exposes_an_unassigned_vehicle()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B"); var c = await ScopeSite(owner, "C");
        var vehicle = await ScopeCar(owner, "MOVE", a.Id); var hidden = await ScopeCar(owner, "HIDDEN", c.Id); var unassigned = await ScopeCar(owner, "UNASSIGNED");
        var group = await ScopedGroup(owner, "Mozgató", company.Id, [a.Id, b.Id], Permissions.VehiclesRead, Permissions.SitesRead, Permissions.SitesAssignVehicles);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        var current = Assert.Single((await member.Client.GetFromJsonAsync<SiteVehicle[]>("/api/v1/company/vehicles"))!);
        Assert.Equal(new[] { a.Id, b.Id }.Order(), current.AssignableSiteIds.Order()); Assert.False(current.CanUnassign);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(null, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(c.Id, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{hidden.Id}/site", new AssignVehicleSite(a.Id, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{unassigned.Id}/site", new AssignVehicleSite(a.Id, 1))).StatusCode);
        Assert.Equal(b.Id, (await ScopeOk<SiteVehicle>(await member.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{vehicle.Id}/site", new AssignVehicleSite(b.Id, 1)))).SiteId);
    }

    [Fact]
    public async Task Scoped_manager_cannot_delegate_full_company_rights_other_sites_or_restore_broader_access()
    {
        using var owner = await Register(); using var manager = await Register(); using var target = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var own = await ScopedGroup(owner, "Telephelykezelő", company.Id, [a.Id], Permissions.VehiclesRead, Permissions.GroupsManage, Permissions.Manage, Permissions.MembersInvite, Permissions.MembersUpdate);
        await CompanyAssign(owner, manager.User.Id, own.Id); Select(manager, company.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Teljes", [Permissions.VehiclesRead], [company.Id]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Másik", [Permissions.VehiclesRead], [company.Id], SiteScopes: [new(company.Id, false, [b.Id])]))).StatusCode);
        var delegated = await ScopedGroup(manager, "Saját terület", company.Id, [a.Id], Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await CompanyAssign(manager, target.User.Id, delegated.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Grants(manager, target.User.Id, Permissions.VehiclesRead)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PostAsJsonAsync("/api/v1/invitations", new CreateInvitationRequest("no-global@example.test", [Permissions.VehiclesRead]))).StatusCode);
        var wider = await ScopedGroup(owner, "Másik terület", company.Id, [b.Id], Permissions.VehiclesRead);
        await CompanyAssign(owner, target.User.Id, wider.Id);
        var access = await Access(owner, target.User.Id);
        await ScopeOk<TenantAccess>(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(false, access.Version)));
        access = await Access(owner, target.User.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(true, access.Version))).StatusCode);
    }

    [Fact]
    public async Task Vehicle_and_site_audits_are_filtered_in_both_audit_endpoints_by_the_granted_audit_scope()
    {
        using var owner = await Register(); using var member = await Register();
        var company = await Company(owner); var a = await ScopeSite(owner, "AUDIT-A"); var b = await ScopeSite(owner, "AUDIT-B");
        var carA = await ScopeCar(owner, "AUDIT-CAR-A", a.Id); var carB = await ScopeCar(owner, "AUDIT-CAR-B", b.Id);
        var group = await ScopedGroup(owner, "Telephelynapló", company.Id, [a.Id], Permissions.VehiclesRead, Permissions.AuditRead);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        foreach (var path in new[] { "/api/v1/audit-events", "/api/v1/company/audit-events" })
        {
            var history = (await member.Client.GetFromJsonAsync<PageResult<AuditSummary>>(path))!.Items;
            Assert.Contains(history, x => x.Action == "site.created" && x.Details.Contains(a.Id.ToString()));
            Assert.DoesNotContain(history, x => x.Action == "site.created" && x.Details.Contains(b.Id.ToString()));
            Assert.DoesNotContain(history, x => x.Details.Contains(carB.Id.ToString()) || x.Details.Contains("AUDIT-CAR-B"));
            if (path == "/api/v1/audit-events") Assert.Contains(history, x => x.Action == "vehicle.created" && x.Details.Contains(carA.Id.ToString()));
        }
    }

    [Fact]
    public async Task Site_scope_validation_rejects_cross_company_empty_duplicate_and_archived_selections()
    {
        using var owner = await Register(); var first = await Company(owner); var a = await ScopeSite(owner, "A");
        var second = await Company(owner); var foreign = await ScopeSite(owner, "FOREIGN"); Select(owner, first.Id);
        foreach (var invalid in new[] { Array.Empty<Guid>(), new[] { a.Id, a.Id }, new[] { foreign.Id } })
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Invalid", [Permissions.VehiclesRead], [first.Id], SiteScopes: [new(first.Id, false, invalid)]))).StatusCode);
        var group = await ScopedGroup(owner, "Valid", first.Id, [a.Id], Permissions.VehiclesRead);
        await ScopeOk<SiteDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/company/sites/{a.Id}/status", new ChangeArchiveStatus(true, "Archiválás", 1)));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Archivált cél", [Permissions.VehiclesRead], [first.Id], SiteScopes: [new(first.Id, false, [a.Id])]))).StatusCode);
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("INSERT INTO company_access_site_scopes (\"GroupId\",\"TenantId\",\"SiteId\") VALUES (@group,@tenant,@site)", connection);
        command.Parameters.AddWithValue("group", group.Id); command.Parameters.AddWithValue("tenant", first.Id); command.Parameters.AddWithValue("site", foreign.Id);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, (await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync())).SqlState);
    }

    [Fact]
    public async Task A_multi_company_group_keeps_each_site_selection_inside_its_own_company()
    {
        using var owner = await Register(); using var member = await Register();
        var first = await Company(owner); var a = await ScopeSite(owner, "A"); var hiddenA = await ScopeSite(owner, "HIDDEN-A");
        var carA = await ScopeCar(owner, "MULTI-A", a.Id); await ScopeCar(owner, "MULTI-HIDDEN-A", hiddenA.Id);
        var second = await Company(owner); var b = await ScopeSite(owner, "B"); var hiddenB = await ScopeSite(owner, "HIDDEN-B");
        var carB = await ScopeCar(owner, "MULTI-B", b.Id); await ScopeCar(owner, "MULTI-HIDDEN-B", hiddenB.Id);
        var group = await ScopedGroup(owner, "Két céges telephely", [new(first.Id, false, [a.Id]), new(second.Id, false, [b.Id])], Permissions.VehiclesRead);
        await CompanyAssign(owner, member.User.Id, group.Id);
        Select(member, first.Id); Assert.Equal(carA.Id, Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Id);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync($"/api/v1/vehicles/{carB.Id}")).StatusCode);
        Select(member, second.Id); Assert.Equal(carB.Id, Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!).Id);
        Select(owner, first.Id);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!.Items.Single(x => x.Action == "group.created");
        Assert.Contains(a.Id.ToString(), audit.Details); Assert.DoesNotContain(b.Id.ToString(), audit.Details);
    }

    [Fact]
    public async Task Future_expanding_site_scoped_permissions_do_not_confer_full_company_admin_delegation()
    {
        using var owner = await Register(); using var manager = await Register(); using var target = await Register();
        var company = await Company(owner); var site = await ScopeSite(owner, "LIMITED-ALL");
        var group = await ScopeOk<PermissionGroupSummary>(await owner.Client.PostAsJsonAsync("/api/v1/permission-groups",
            new CreateGroupRequest("Telephely minden művelet", [], [company.Id], true, [new(company.Id, false, [site.Id])])));
        await CompanyAssign(owner, manager.User.Id, group.Id); Select(manager, company.Id);
        Assert.False(Assert.Single((await manager.Client.GetFromJsonAsync<GroupCompanyOption[]>("/api/v1/permission-groups/companies"))!).CanGrantAll);
        var admin = Assert.Single((await owner.Client.GetFromJsonAsync<PermissionGroupSummary[]>("/api/v1/permission-groups"))!, x => x.IsAdmin);
        Assert.Equal(HttpStatusCode.Forbidden, (await CompanyAssign(manager, target.User.Id, admin.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Grants(manager, manager.User.Id, Permissions.VehiclesRead)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PostAsJsonAsync("/api/v1/permission-groups", new CreateGroupRequest("Másik admin", [], [company.Id], true))).StatusCode);
        await CompanyAssign(owner, target.User.Id, group.Id);
        var membership = await Access(owner, target.User.Id);
        await ScopeOk<TenantAccess>(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(false, membership.Version)));
        membership = await Access(owner, target.User.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PatchAsJsonAsync($"/api/v1/members/{target.User.Id}/status", new ChangeMemberStatusRequest(true, membership.Version))).StatusCode);
    }

    [Fact]
    public async Task A_pending_invitation_cannot_grant_full_company_access_after_its_issuer_becomes_site_restricted()
    {
        using var owner = await Register(); using var issuer = await Register(); using var recipient = await Register();
        var company = await Company(owner); var site = await ScopeSite(owner, "ISSUER");
        var group = await CompanyGroup(owner, "Meghívó kezelő", [company.Id], Permissions.Manage, Permissions.MembersInvite, Permissions.VehiclesRead);
        await CompanyAssign(owner, issuer.User.Id, group.Id); Select(issuer, company.Id);
        var invitation = await Invite(issuer, recipient, Permissions.VehiclesRead);
        await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}",
            new UpdateGroupRequest(group.Name, group.Permissions, [company.Id], group.Version, SiteScopes: [new(company.Id, false, [site.Id])])));
        Assert.Equal(HttpStatusCode.Conflict, (await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invitation.Acceptance)).StatusCode);
    }
}
