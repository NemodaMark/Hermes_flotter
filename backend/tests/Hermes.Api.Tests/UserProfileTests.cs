using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class UserProfileTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private sealed record Account(HttpClient Client, string Id, string Email) : IDisposable { public void Dispose() => Client.Dispose(); }
    private async Task<Account> Register(bool system = false)
    {
        var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        var email = $"profile-{Guid.NewGuid():N}@example.test";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", new { displayName = "Profil Teszt", email, password = FleetFixture.Password, systemPermissions = new[] { SystemPermissions.Manage } });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var user = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = user.GetProperty("id").GetString()!;
        Assert.Equal(7, Guid.Parse(id).Version);
        Assert.Empty(user.GetProperty("systemPermissions").EnumerateArray());
        if (system)
        {
            await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
            db.SystemPermissionGrants.Add(new() { UserId = id, Code = SystemPermissions.Manage });
            await db.SaveChangesAsync();
        }
        await FleetFixture.RefreshCsrfAsync(client);
        return new(client, id, email);
    }
    private static string Path(Account target) => $"/api/v1/system/users/{target.Id}";
    private static async Task<UserProfile> Profile(Account actor, Account target)
        => (await actor.Client.GetFromJsonAsync<UserProfile>(Path(target)))!;
    private static async Task<UserProfile> Force(Account admin, Account target)
    {
        var profile = await Profile(admin, target);
        var response = await admin.Client.PostAsJsonAsync($"{Path(target)}/require-password-change", new { version = profile.Version });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserProfile>())!;
    }
    private async Task<HttpClient> Login(Account target, string? password = null)
    {
        var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = target.Email, password = password ?? FleetFixture.Password })).StatusCode);
        await FleetFixture.RefreshCsrfAsync(client);
        return client;
    }

    [Fact]
    public async Task Company_permissions_and_forged_inputs_never_grant_global_profile_access()
    {
        using var owner = await Register();
        using var target = await Register();
        Assert.Equal(HttpStatusCode.Created, (await owner.Client.PostAsJsonAsync("/api/v1/tenants", new { name = "Céges kezelő" })).StatusCode);
        foreach (var path in new[] { "/api/v1/system/users", Path(target), "/api/v1/system/audit-events" })
            Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.PutAsJsonAsync(Path(target), new { displayName = "Átírt", email = target.Email, version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.PostAsJsonAsync($"{Path(target)}/require-password-change", new { version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.PutAsJsonAsync($"{Path(owner)}/system-access", new { enabled = true, version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.PutAsJsonAsync("/api/v1/auth/profile", new { displayName = "Saját név", systemPermissions = new[] { SystemPermissions.Manage }, passwordChangeRequired = false })).StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<JsonElement>("/api/v1/auth/session")).GetProperty("systemPermissions").EnumerateArray());
    }

    [Fact]
    public async Task System_permission_opens_all_companies_without_creating_memberships_and_is_revoked_immediately()
    {
        using var admin = await Register(true);
        using var owner = await Register();
        var company = (await (await owner.Client.PostAsJsonAsync("/api/v1/tenants", new { name = "Más cég" })).Content.ReadFromJsonAsync<TenantSummary>())!;
        var companies = (await admin.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!;
        Assert.Contains(companies, x => x.Id == company.Id);
        admin.Client.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        Assert.Equal(HttpStatusCode.Created, (await admin.Client.PostAsJsonAsync("/api/v1/vehicles", new { registration = "SYS-001", make = "Ford", model = "Focus" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.Client.GetAsync("/api/v1/members")).StatusCode);
        Assert.Equal(Permissions.All.Order(), (await admin.Client.GetFromJsonAsync<TenantAccess>("/api/v1/tenant/access"))!.Permissions.Order());
        var invite = await admin.Client.PostAsJsonAsync("/api/v1/invitations", new { email = $"next-{Guid.NewGuid():N}@example.test", permissions = new[] { Permissions.VehiclesRead } });
        Assert.Equal(HttpStatusCode.Created, invite.StatusCode);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        Assert.False(await db.Memberships.AnyAsync(x => x.TenantId == company.Id && x.UserSubject == admin.Id));
        var audit = await db.SystemAuditEvents.SingleAsync(x => x.ActorSubject == admin.Id && x.Action == "invitation.created");
        Assert.Equal(company.Id, audit.TenantId);
        db.SystemPermissionGrants.Remove(await db.SystemPermissionGrants.SingleAsync(x => x.UserId == admin.Id));
        await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.Client.GetAsync("/api/v1/vehicles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.Client.GetAsync(Path(owner))).StatusCode);
    }

    [Fact]
    public async Task Profile_edits_are_whitelisted_versioned_unique_and_audited_with_a_stable_id()
    {
        using var admin = await Register(true);
        using var target = await Register();
        var before = await Profile(admin, target);
        var email = $"edited-{Guid.NewGuid():N}@example.test";
        var response = await admin.Client.PutAsJsonAsync(Path(target), new { displayName = "Új név", email, phoneNumber = "+36 30 1234567", version = before.Version, id = "forged", passwordHash = "forged", passwordChangeRequired = true, systemPermissions = new[] { SystemPermissions.Manage } });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var after = (await response.Content.ReadFromJsonAsync<UserProfile>())!;
        Assert.Equal(target.Id, after.Id);
        Assert.Equal(before.Version + 1, after.Version);
        Assert.Equal("Új név", after.DisplayName);
        Assert.Equal("+36 30 1234567", after.PhoneNumber);
        Assert.False(after.PasswordChangeRequired);
        Assert.Empty(after.SystemPermissions);
        foreach (var secret in new[] { "passwordHash", "securityStamp", "concurrencyStamp", "accessFailedCount" })
            Assert.DoesNotContain(secret, await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.Client.PutAsJsonAsync(Path(target), new { displayName = "Elavult", email, version = before.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.Client.PutAsJsonAsync(Path(target), new { displayName = "Duplikált", email = admin.Email.ToUpperInvariant(), version = after.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await target.Client.GetAsync("/api/v1/auth/session")).StatusCode);
        using var changedLogin = await Login(target with { Email = email.ToUpperInvariant() });
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        var saved = await db.Users.AsNoTracking().SingleAsync(x => x.Id == target.Id);
        Assert.Equal(email.ToUpperInvariant(), saved.NormalizedEmail);
        Assert.Equal(email, saved.UserName);
        Assert.NotEqual("forged", saved.PasswordHash);
        var entry = await db.SystemAuditEvents.SingleAsync(x => x.Action == "user.profile_changed" && x.TargetSubject == target.Id);
        Assert.Equal(admin.Id, entry.ActorSubject);
        Assert.Contains(target.Email, entry.Details);
        Assert.Contains(email, entry.Details);
        Assert.DoesNotContain(FleetFixture.Password, entry.Details);
        Assert.Equal(after.Version, (await Profile(admin, target)).Version);
    }

    [Fact]
    public async Task A_system_revocation_wins_over_a_vehicle_write_waiting_for_authorization_lock()
    {
        using var admin = await Register(true);
        using var owner = await Register();
        var company = (await (await owner.Client.PostAsJsonAsync("/api/v1/tenants", new { name = "Párhuzamos visszavonás" })).Content.ReadFromJsonAsync<TenantSummary>())!;
        admin.Client.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        owner.Client.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        await using var connection = new NpgsqlConnection(fixture.MigrationConnection);
        await connection.OpenAsync();
        await using var tx = await connection.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand("SELECT pg_advisory_xact_lock(724385916)", connection, tx)) await command.ExecuteNonQueryAsync();
        var write = admin.Client.PostAsJsonAsync("/api/v1/vehicles", new { registration = "RACE-001", make = "Ford", model = "Focus" });
        var waiting = false;
        for (var attempt = 0; attempt < 100; attempt++)
        {
            await using var command = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = 724385916 AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))", connection, tx);
            if ((bool)(await command.ExecuteScalarAsync())!) { waiting = true; break; }
            await Task.Delay(20);
        }
        Assert.True(waiting, "The HTTP write must reach the authorization lock before revocation.");
        await using (var command = new NpgsqlCommand("DELETE FROM system_permission_grants WHERE \"UserId\" = @id", connection, tx))
        {
            command.Parameters.AddWithValue("id", admin.Id);
            await command.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await write).StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!);
    }

    [Fact]
    public async Task Concurrent_profile_edits_cannot_overwrite_each_other()
    {
        using var admin = await Register(true);
        using var target = await Register();
        var profile = await Profile(admin, target);
        var responses = await Task.WhenAll(new[] { "Első", "Második" }.Select(name => admin.Client.PutAsJsonAsync(Path(target), new { displayName = name, email = target.Email, version = profile.Version })));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict);
        Assert.Equal(profile.Version + 1, (await Profile(admin, target)).Version);
    }

    [Fact]
    public async Task Admin_writes_require_csrf_explicit_access_status_and_valid_fields_without_partial_changes()
    {
        using var admin = await Register(true);
        using var target = await Register();
        var before = await Profile(admin, target);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.Client.PutAsJsonAsync($"{Path(target)}/system-access", new { version = before.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.Client.PutAsJsonAsync(Path(target), new { displayName = "", email = target.Email, version = before.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.Client.PutAsJsonAsync(Path(target), new { displayName = "Valid", email = "invalid", version = before.Version })).StatusCode);
        admin.Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.Client.PutAsJsonAsync(Path(target), new { displayName = "Forbidden", email = target.Email, version = before.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.Client.PostAsJsonAsync($"{Path(target)}/require-password-change", new { version = before.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.Client.PutAsJsonAsync($"{Path(target)}/system-access", new { enabled = true, version = before.Version })).StatusCode);
        var after = await Profile(admin, target);
        Assert.Equal(before.Version, after.Version);
        Assert.Equal(before.DisplayName, after.DisplayName);
        Assert.Equal(before.Email, after.Email);
        Assert.False(after.PasswordChangeRequired);
        Assert.Empty(after.SystemPermissions);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        Assert.False(await db.SystemAuditEvents.AnyAsync(x => x.TargetSubject == target.Id));
    }

    [Fact]
    public async Task Forced_change_invalidates_old_sessions_and_blocks_every_business_api_until_password_is_changed()
    {
        using var admin = await Register(true);
        using var target = await Register();
        var profile = await Force(admin, target);
        Assert.True(profile.PasswordChangeRequired);
        Assert.NotNull(profile.PasswordChangeRequestedAt);
        Assert.Equal(HttpStatusCode.Unauthorized, (await target.Client.GetAsync("/api/v1/auth/session")).StatusCode);
        using var restricted = await Login(target);
        Assert.True((await restricted.GetFromJsonAsync<JsonElement>("/api/v1/auth/session")).GetProperty("passwordChangeRequired").GetBoolean());
        foreach (var path in new[] { "/api/v1/tenants", "/api/v1/permissions", "/api/v1/vehicles", "/api/v1/system/users" })
        {
            var denied = await restricted.GetAsync(path);
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.Equal("password_change_required", (await denied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await restricted.PutAsJsonAsync("/api/v1/auth/profile", new { displayName = "Bypass" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await restricted.PostAsJsonAsync("/api/v1/tenants", new { name = "Bypass" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await restricted.PostAsJsonAsync("/api/v1/invitations/accept", new { tenantId = Guid.NewGuid(), invitationId = Guid.NewGuid(), token = "fake" })).StatusCode);
        foreach (var input in new[] {
            new ChangePasswordRequest("wrong-password", "New-long-password-42", "New-long-password-42"),
            new ChangePasswordRequest(FleetFixture.Password, "short", "short"),
            new ChangePasswordRequest(FleetFixture.Password, FleetFixture.Password, FleetFixture.Password),
            new ChangePasswordRequest(FleetFixture.Password, "New-long-password-42", "Mismatch-password-42") })
            Assert.Equal(HttpStatusCode.BadRequest, (await restricted.PostAsJsonAsync("/api/v1/auth/change-password", input)).StatusCode);
        Assert.True((await Profile(admin, target)).PasswordChangeRequired);
        restricted.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        var change = new ChangePasswordRequest(FleetFixture.Password, "New-long-password-42", "New-long-password-42");
        Assert.Equal(HttpStatusCode.BadRequest, (await restricted.PostAsJsonAsync("/api/v1/auth/change-password", change)).StatusCode);
        await FleetFixture.RefreshCsrfAsync(restricted);
        var changed = await restricted.PostAsJsonAsync("/api/v1/auth/change-password", change);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.False((await changed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("passwordChangeRequired").GetBoolean());
        await FleetFixture.RefreshCsrfAsync(restricted);
        Assert.Equal(HttpStatusCode.OK, (await restricted.GetAsync("/api/v1/tenants")).StatusCode);
        using var newLogin = await Login(target, change.NewPassword);
        using var oldLogin = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(oldLogin);
        Assert.Equal(HttpStatusCode.Unauthorized, (await oldLogin.PostAsJsonAsync("/api/v1/auth/login", new { email = target.Email, password = FleetFixture.Password })).StatusCode);
        var audit = (await admin.Client.GetFromJsonAsync<PageResult<SystemAuditSummary>>("/api/v1/system/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "user.password_change_required" && x.ActorSubject == admin.Id && x.TargetSubject == target.Id);
        Assert.Contains(audit.Items, x => x.Action == "user.password_changed" && x.ActorSubject == target.Id);
        Assert.DoesNotContain(change.NewPassword, JsonSerializer.Serialize(audit));
    }

    [Fact]
    public async Task Password_change_preserves_only_the_current_session_and_persists_failed_attempt_lockout()
    {
        using var target = await Register();
        using var otherDevice = await Login(target);
        var input = new ChangePasswordRequest(FleetFixture.Password, "Another-long-password-42", "Another-long-password-42");
        Assert.Equal(HttpStatusCode.OK, (await target.Client.PostAsJsonAsync("/api/v1/auth/change-password", input)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await target.Client.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await otherDevice.GetAsync("/api/v1/auth/session")).StatusCode);
        await FleetFixture.RefreshCsrfAsync(target.Client);
        for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.BadRequest, (await target.Client.PostAsJsonAsync("/api/v1/auth/change-password", input with { CurrentPassword = "wrong" })).StatusCode);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        Assert.True((await db.Users.SingleAsync(x => x.Id == target.Id)).LockoutEnd > DateTimeOffset.UtcNow);
        Assert.Equal(HttpStatusCode.BadRequest, (await target.Client.PostAsJsonAsync("/api/v1/auth/change-password", input with { CurrentPassword = input.NewPassword, NewPassword = "Yet-another-password-42", ConfirmPassword = "Yet-another-password-42" })).StatusCode);
    }

    [Fact]
    public async Task System_access_delegation_is_audited_and_cannot_remove_the_last_manager()
    {
        using var admin = await Register(true);
        using var target = await Register();
        // This test owns the fixture database; leave exactly one manager for the last-manager invariant.
        await using (var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
            await db.SystemPermissionGrants.Where(x => x.UserId != admin.Id).ExecuteDeleteAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.Client.PutAsJsonAsync($"{Path(admin)}/system-access", new { enabled = false, version = 1 })).StatusCode);
        var targetProfile = await Profile(admin, target);
        Assert.Equal(HttpStatusCode.OK, (await admin.Client.PutAsJsonAsync($"{Path(target)}/system-access", new { enabled = true, version = targetProfile.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await target.Client.GetAsync("/api/v1/system/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.Client.PutAsJsonAsync($"{Path(admin)}/system-access", new { enabled = false, version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.Client.GetAsync("/api/v1/system/users")).StatusCode);
        var audit = (await target.Client.GetFromJsonAsync<PageResult<SystemAuditSummary>>("/api/v1/system/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "user.system_access_changed" && x.TargetSubject == target.Id && x.ActorSubject == admin.Id);
        await using var check = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        Assert.Equal(2, await check.SystemAuditEvents.CountAsync(x => x.Action == "user.system_access_changed" && x.ActorSubject == admin.Id));
    }

    [Fact]
    public async Task Central_audit_history_cannot_be_updated_or_deleted_by_the_runtime_database_role()
    {
        using var admin = await Register(true);
        using var target = await Register();
        await Force(admin, target);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        var entry = await db.SystemAuditEvents.SingleAsync(x => x.TargetSubject == target.Id && x.Action == "user.password_change_required");
        var update = await Assert.ThrowsAnyAsync<Exception>(() => db.SystemAuditEvents.Where(x => x.Id == entry.Id).ExecuteUpdateAsync(set => set.SetProperty(x => x.Action, "forged")));
        Assert.Equal("55000", Assert.IsType<PostgresException>(update.GetBaseException()).SqlState);
        var delete = await Assert.ThrowsAnyAsync<Exception>(() => db.SystemAuditEvents.Where(x => x.Id == entry.Id).ExecuteDeleteAsync());
        Assert.Equal("55000", Assert.IsType<PostgresException>(delete.GetBaseException()).SqlState);
    }

    [Fact]
    public async Task Bootstrap_is_explicit_one_time_and_does_not_grant_every_company_creator_global_access()
    {
        using var first = await Register();
        await using var db = FleetFixture.CreateContext(fixture.MigrationConnection, new TenantContext());
        await db.SystemPermissionGrants.ExecuteDeleteAsync();
        await UserAccounts.Bootstrap(db, first.Id, default);
        Assert.Equal(SystemPermissions.Manage, (await db.SystemPermissionGrants.SingleAsync()).Code);
        await Assert.ThrowsAsync<InvalidOperationException>(() => UserAccounts.Bootstrap(db, first.Id, default));
        Assert.Equal("bootstrap:database-operator", (await db.SystemAuditEvents.SingleAsync(x => x.TargetSubject == first.Id && x.Action == "user.system_access_bootstrapped")).ActorSubject);
    }
}
