using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class PermissionManagementTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private sealed record User(string Id, string DisplayName, string Email);
    private sealed record Account(HttpClient Client, User User) : IDisposable
    { public void Dispose() => Client.Dispose(); }

    private async Task<Account> Register()
    {
        var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new
        { displayName = "Jogosultság Teszt", email = $"access-{Guid.NewGuid():N}@example.test", password = FleetFixture.Password });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var user = (await response.Content.ReadFromJsonAsync<User>())!;
        await FleetFixture.RefreshCsrfAsync(client);
        return new(client, user);
    }
    private static void Select(Account account, Guid tenant)
    {
        account.Client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        account.Client.DefaultRequestHeaders.Add("X-Tenant-Id", tenant.ToString());
    }
    private static async Task<TenantSummary> Company(Account owner)
    {
        var response = await owner.Client.PostAsJsonAsync("/api/v1/tenants", new { name = "Jogosultsági tesztcég" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var company = (await response.Content.ReadFromJsonAsync<TenantSummary>())!;
        Select(owner, company.Id);
        return company;
    }
    private static async Task<CreatedInvitation> Invite(Account owner, Account recipient, params string[] permissions)
    {
        var response = await owner.Client.PostAsJsonAsync("/api/v1/invitations", new { email = recipient.User.Email.ToUpperInvariant(), permissions });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreatedInvitation>())!;
    }
    private static async Task Join(Account owner, Account recipient, Guid tenant, params string[] permissions)
    {
        var invite = await Invite(owner, recipient, permissions);
        var response = await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invite.Acceptance);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Select(recipient, tenant);
    }
    private static async Task<TenantAccess> Access(Account actor, string userId)
        => (await actor.Client.GetFromJsonAsync<TenantAccess>($"/api/v1/members/{userId}/permissions"))!;
    private static async Task<HttpResponseMessage> Grants(Account actor, string userId, params string[] permissions)
    {
        var current = await Access(actor, userId);
        return await actor.Client.PutAsJsonAsync($"/api/v1/members/{userId}/permissions", new { permissions, current.Version });
    }
    private static async Task AssertCode(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Direct_grants_are_independent_and_revocation_applies_without_logging_in_again()
    {
        using var owner = await Register();
        using var member = await Register();
        var company = await Company(owner);
        await Join(owner, member, company.Id);
        Assert.Empty((await member.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!.Permissions);
        foreach (var path in new[] { "vehicles", "members", "invitations", "audit-events" })
            Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/v1/{path}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id, Permissions.VehiclesCreate)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await member.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("ONLY-001", "Ford", "Focus"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id, Permissions.VehiclesRead)).StatusCode);
        Assert.Single((await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("ONLY-002", "Ford", "Focus"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id)).StatusCode);
        member.Client.DefaultRequestHeaders.Add("X-Role", "Owner");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/permissions", new { permissions = Permissions.All, version = 4 })).StatusCode);
    }

    [Fact]
    public async Task Member_directory_is_company_scoped_and_never_returns_identity_secrets()
    {
        using var owner = await Register();
        using var member = await Register();
        using var stranger = await Register();
        var first = await Company(owner);
        await Join(owner, member, first.Id, Permissions.MembersRead);
        var second = await Company(owner);
        await Join(owner, stranger, second.Id, Permissions.VehiclesRead);
        Select(owner, first.Id);
        var response = await owner.Client.GetAsync("/api/v1/members?page=1&pageSize=1");
        var list = (await response.Content.ReadFromJsonAsync<PageResult<MemberSummary>>())!;
        Assert.Equal(2, list.Total);
        Assert.Single(list.Items);
        var searched = (await owner.Client.GetFromJsonAsync<PageResult<MemberSummary>>($"/api/v1/members?search={Uri.EscapeDataString(member.User.Email)}"))!;
        Assert.Equal(member.User.Id, Assert.Single(searched.Items).UserId);
        var text = await response.Content.ReadAsStringAsync();
        foreach (var secret in new[] { "passwordHash", "securityStamp", "concurrencyStamp", "tokenHash", "phoneNumber" })
            Assert.DoesNotContain(secret, text, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync($"/api/v1/members/{stranger.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/members")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/v1/members/{owner.User.Id}/permissions")).StatusCode);
        Select(member, second.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/members")).StatusCode);
    }

    [Fact]
    public async Task Limited_delegators_cannot_expand_their_own_or_other_members_rights()
    {
        using var owner = await Register();
        using var manager = await Register();
        using var member = await Register();
        var company = await Company(owner);
        await Join(owner, manager, company.Id, Permissions.Manage, Permissions.VehiclesRead);
        await Join(owner, member, company.Id, Permissions.VehiclesCreate);
        await AssertCode(await Grants(manager, manager.User.Id, Permissions.Manage, Permissions.VehiclesRead, Permissions.VehiclesCreate), HttpStatusCode.Forbidden, "delegation_denied");
        await AssertCode(await Grants(manager, member.User.Id), HttpStatusCode.Forbidden, "delegation_denied");
        // An unrelated existing grant can remain; only the changed rights must be within the actor's scope.
        Assert.Equal(HttpStatusCode.OK, (await Grants(manager, member.User.Id, Permissions.VehiclesCreate, Permissions.VehiclesRead)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PostAsJsonAsync("/api/v1/invitations", new { email = "outsider@example.test", permissions = Array.Empty<string>() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { isActive = false, version = 2 })).StatusCode);
    }

    [Fact]
    public async Task Last_manager_is_protected_even_when_two_managers_concurrently_remove_their_own_grant()
    {
        using var owner = await Register();
        using var manager = await Register();
        var company = await Company(owner);
        await AssertCode(await Grants(owner, owner.User.Id), HttpStatusCode.Conflict, "last_permission_manager");
        await AssertCode(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{owner.User.Id}/status", new { isActive = false, version = 1 }), HttpStatusCode.Conflict, "last_permission_manager");
        await Join(owner, manager, company.Id, Permissions.Manage);
        var responses = await Task.WhenAll(
            owner.Client.PutAsJsonAsync($"/api/v1/members/{owner.User.Id}/permissions", new { permissions = Permissions.All.Where(code => code != Permissions.Manage).ToArray(), version = 1 }),
            manager.Client.PutAsJsonAsync($"/api/v1/members/{manager.User.Id}/permissions", new { permissions = Array.Empty<string>(), version = 1 }));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        await AssertCode(Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "last_permission_manager");
        var own = (await owner.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!;
        var other = (await manager.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!;
        Assert.Single(new[] { own, other }, item => item.Permissions.Contains(Permissions.Manage));
    }

    [Fact]
    public async Task Stale_memberships_and_invalid_management_inputs_are_rejected()
    {
        using var owner = await Register();
        using var member = await Register();
        var company = await Company(owner);
        await Join(owner, member, company.Id);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, member.User.Id, Permissions.VehiclesRead)).StatusCode);
        await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/permissions", new { permissions = Array.Empty<string>(), version = 1 }), HttpStatusCode.Conflict, "stale_membership");
        foreach (var permissions in new string[]?[] { null, ["Owner"], [Permissions.VehiclesRead, Permissions.VehiclesRead], [null!] })
            await AssertCode(await owner.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/permissions", new { permissions, version = 2 }), HttpStatusCode.BadRequest, "invalid_permissions");
        await AssertCode(await owner.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { version = 2 }), HttpStatusCode.BadRequest, "missing_status");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync("/api/v1/members?pageSize=101")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync("/api/v1/audit-events?page=0")).StatusCode);
        Assert.Equal(2, (await Access(owner, member.User.Id)).Version);
    }

    [Fact]
    public async Task Suspension_only_removes_the_selected_company_and_reactivation_checks_grant_scope()
    {
        using var owner = await Register();
        using var member = await Register();
        using var operatorAccount = await Register();
        var first = await Company(owner);
        await Join(owner, member, first.Id, Permissions.VehiclesRead);
        await Join(owner, operatorAccount, first.Id, Permissions.MembersUpdate);
        var second = await Company(member);
        Select(member, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await operatorAccount.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { isActive = false, version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/tenant/access")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal(second.Id, Assert.Single((await member.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
        Select(member, second.Id);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        await AssertCode(await operatorAccount.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { isActive = true, version = 2 }), HttpStatusCode.Forbidden, "delegation_denied");
        Select(owner, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{member.User.Id}/status", new { isActive = true, version = 2 })).StatusCode);
        Select(member, first.Id);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync("/api/v1/vehicles")).StatusCode);
    }

    [Fact]
    public async Task Invitations_are_email_bound_hashed_single_use_and_do_not_leak_tokens()
    {
        using var owner = await Register();
        using var recipient = await Register();
        using var wrongUser = await Register();
        var company = await Company(owner);
        var invite = await Invite(owner, recipient, Permissions.VehiclesRead);
        Assert.Equal(43, invite.Acceptance.Token.Length);
        await using (var connection = new NpgsqlConnection(fixture.ApplicationConnection))
        {
            await connection.OpenAsync();
            await using var tx = await connection.BeginTransactionAsync();
            await using var command = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, tx);
            command.Parameters.AddWithValue("tenant", company.Id.ToString());
            await command.ExecuteNonQueryAsync();
            command.CommandText = "SELECT \"TokenHash\" FROM tenant_invitations WHERE \"Id\" = @id";
            command.Parameters.AddWithValue("id", invite.Invitation.Id);
            Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(invite.Acceptance.Token))), await command.ExecuteScalarAsync());
        }
        var listing = await owner.Client.GetStringAsync("/api/v1/invitations");
        Assert.DoesNotContain("token", listing, StringComparison.OrdinalIgnoreCase);
        await AssertCode(await wrongUser.Client.PostAsJsonAsync("/api/v1/invitations/accept", invite.Acceptance), HttpStatusCode.Forbidden, "invitation_email_mismatch");
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invite.Acceptance with { Token = "wrong" }), HttpStatusCode.NotFound, "invalid_invitation");
        await AssertCode(await owner.Client.PostAsJsonAsync("/api/v1/invitations", new { email = recipient.User.Email, permissions = Array.Empty<string>() }), HttpStatusCode.Conflict, "pending_invitation");
        Assert.Equal(HttpStatusCode.OK, (await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invite.Acceptance)).StatusCode);
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invite.Acceptance), HttpStatusCode.Conflict, "invitation_unavailable");
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, item => item.ActorSubject == owner.User.Id && item.Action == "invitation.created");
        Assert.Contains(audit.Items, item => item.ActorSubject == recipient.User.Id && item.TargetSubject == recipient.User.Id && item.Action == "invitation.accepted");
        Assert.DoesNotContain(invite.Acceptance.Token, JsonSerializer.Serialize(audit));
    }

    [Fact]
    public async Task Revoked_expired_and_no_longer_authorized_invitations_cannot_create_memberships()
    {
        using var owner = await Register();
        using var recipient = await Register();
        var company = await Company(owner);
        var revoked = await Invite(owner, recipient, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"/api/v1/invitations/{revoked.Invitation.Id}")).StatusCode);
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", revoked.Acceptance), HttpStatusCode.Conflict, "invitation_unavailable");
        var expired = await Invite(owner, recipient);
        var context = new TenantContext();
        context.Set(company.Id, owner.User.Id, Permissions.All);
        await using (var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context))
            await TenantTransaction.RunAsync(db, company.Id, async () =>
            {
                var stored = await db.Invitations.SingleAsync(item => item.Id == expired.Invitation.Id);
                db.Entry(stored).Property(item => item.ExpiresAt).CurrentValue = DateTimeOffset.UtcNow.AddMinutes(-1);
                await db.SaveChangesAsync();
                return true;
            }, default);
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", expired.Acceptance), HttpStatusCode.Conflict, "invitation_unavailable");
        // Reissuing after expiry must free the partial unique index before inserting the replacement.
        var stale = await Invite(owner, recipient, Permissions.VehiclesRead);
        Assert.Equal(HttpStatusCode.OK, (await Grants(owner, owner.User.Id, Permissions.All.Where(code => code != Permissions.MembersInvite).ToArray())).StatusCode);
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", stale.Acceptance), HttpStatusCode.Conflict, "inviter_access_changed");
        Assert.Empty((await recipient.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
    }

    [Fact]
    public async Task Invitation_only_permission_can_invite_but_cannot_assign_grants_or_overwrite_members()
    {
        using var owner = await Register();
        using var inviter = await Register();
        using var recipient = await Register();
        var company = await Company(owner);
        await Join(owner, inviter, company.Id, Permissions.MembersInvite);
        Assert.Equal(HttpStatusCode.Forbidden, (await inviter.Client.PostAsJsonAsync("/api/v1/invitations", new { email = recipient.User.Email, permissions = new[] { Permissions.VehiclesRead } })).StatusCode);
        var invitation = await Invite(inviter, recipient);
        Assert.Equal(HttpStatusCode.OK, (await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invitation.Acceptance)).StatusCode);
        await AssertCode(await inviter.Client.PostAsJsonAsync("/api/v1/invitations", new { email = recipient.User.Email, permissions = Array.Empty<string>() }), HttpStatusCode.Conflict, "already_member");
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PatchAsJsonAsync($"/api/v1/members/{recipient.User.Id}/status", new { isActive = false, version = 1 })).StatusCode);
        await AssertCode(await inviter.Client.PostAsJsonAsync("/api/v1/invitations", new { email = recipient.User.Email, permissions = Array.Empty<string>() }), HttpStatusCode.Conflict, "already_member");
    }

    [Fact]
    public async Task New_tenant_tables_enforce_rls_for_unscoped_reads_and_cross_company_writes()
    {
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection);
        await connection.OpenAsync();
        foreach (var table in new[] { "tenant_membership_permissions", "tenant_invitations", "tenant_invitation_permissions", "access_audit_events" })
        {
            await using var unscoped = new NpgsqlCommand($"SELECT count(*) FROM {table}", connection);
            Assert.Equal(0L, await unscoped.ExecuteScalarAsync());
        }
        await using var tx = await connection.BeginTransactionAsync();
        await using var scope = new NpgsqlCommand("SELECT set_config('app.tenant_id', @tenant, true)", connection, tx);
        scope.Parameters.AddWithValue("tenant", TestFleetData.DunaId.ToString());
        await scope.ExecuteNonQueryAsync();
        await using var insert = new NpgsqlCommand("""
            INSERT INTO tenant_membership_permissions ("TenantId", "UserSubject", "Code") VALUES (@other, 'test:anna', 'members.read')
            """, connection, tx);
        insert.Parameters.AddWithValue("other", TestFleetData.PannonId);
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, (await Assert.ThrowsAsync<PostgresException>(() => insert.ExecuteNonQueryAsync())).SqlState);
    }

    [Fact]
    public async Task Company_switching_does_not_expose_other_invitations_or_audit_events()
    {
        using var owner = await Register();
        using var recipient = await Register();
        var first = await Company(owner);
        var invitation = await Invite(owner, recipient, Permissions.VehiclesRead);
        var second = await Company(owner);
        Assert.Empty((await owner.Client.GetFromJsonAsync<PageResult<InvitationSummary>>("/api/v1/invitations"))!.Items);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Equal("company.created", Assert.Single(audit.Items).Action);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.DeleteAsync($"/api/v1/invitations/{invitation.Invitation.Id}")).StatusCode);
        await AssertCode(await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invitation.Acceptance with { TenantId = second.Id }), HttpStatusCode.NotFound, "invalid_invitation");
        Assert.Equal(HttpStatusCode.OK, (await recipient.Client.PostAsJsonAsync("/api/v1/invitations/accept", invitation.Acceptance)).StatusCode);
        Assert.Equal(first.Id, Assert.Single((await recipient.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!).Id);
    }

    [Fact]
    public async Task Concurrent_updates_of_one_membership_cannot_silently_overwrite_each_other()
    {
        using var owner = await Register();
        using var member = await Register();
        var company = await Company(owner);
        await Join(owner, member, company.Id);
        var responses = await Task.WhenAll(
            owner.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/permissions", new { permissions = new[] { Permissions.VehiclesRead }, version = 1 }),
            owner.Client.PutAsJsonAsync($"/api/v1/members/{member.User.Id}/permissions", new { permissions = new[] { Permissions.VehiclesCreate }, version = 1 }));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
        await AssertCode(Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "stale_membership");
        Assert.Equal(2, (await Access(owner, member.User.Id)).Version);
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Single(audit.Items, item => item.Action == "member.permissions_changed" && item.TargetSubject == member.User.Id);
    }

    [Fact]
    public async Task Profile_updates_only_the_current_users_display_name_and_catalog_is_authenticated()
    {
        using var account = await Register();
        var response = await account.Client.PutAsJsonAsync("/api/v1/auth/profile", new { displayName = "Új Név", id = "test:anna", role = "Owner" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(account.User.Id, (await response.Content.ReadFromJsonAsync<User>())!.Id);
        Assert.Equal("Új Név", (await account.Client.GetFromJsonAsync<User>("/api/v1/auth/session"))!.DisplayName);
        Assert.Equal(HttpStatusCode.BadRequest, (await account.Client.PutAsJsonAsync("/api/v1/auth/profile", new { displayName = " " })).StatusCode);
        var catalog = (await account.Client.GetFromJsonAsync<PermissionDescription[]>("/api/v1/permissions"))!;
        Assert.Equal(Permissions.All.Order(), catalog.Select(item => item.Code).Order());
        using var anonymous = await fixture.ClientAsync(null);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/permissions")).StatusCode);
    }
}
