using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class UsernameTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private async Task<HttpClient> Anonymous()
    {
        var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        return client;
    }
    private static object Registration(string name) => new { userName = name, displayName = "Név független azonosító", email = $"email-{Guid.NewGuid():N}@example.test", password = FleetFixture.Password };

    [Fact]
    public async Task Username_is_the_actual_primary_key_and_survives_name_and_email_edits()
    {
        using var client = await Anonymous();
        var name = $"name-{Guid.NewGuid():N}";
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", Registration($" {name.ToUpperInvariant()} "));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var session = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(name, session.GetProperty("id").GetString());
        await using (var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
        {
            var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == name);
            Assert.Equal(name, user.UserName);
            Assert.Equal(name.ToUpperInvariant(), user.NormalizedUserName);
            Assert.Equal(name, (await db.UserIdentityHistory.SingleAsync(x => x.PreviousId == name)).UserId);
            db.SystemPermissionGrants.Add(new() { UserId = name, Code = Domain.SystemPermissions.Manage });
            await db.SaveChangesAsync();
        }
        await FleetFixture.RefreshCsrfAsync(client);
        var profile = (await client.GetFromJsonAsync<UserProfile>($"/api/v1/system/users/{name}"))!;
        var email = $"changed-{Guid.NewGuid():N}@example.test";
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync($"/api/v1/system/users/{name}", new { displayName = "Másik Név", email, version = profile.Version, id = "replacement", userName = "replacement" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/session")).StatusCode);
        using var byName = await Anonymous();
        var login = await byName.PostAsJsonAsync("/api/v1/auth/login", new { userName = name.ToUpperInvariant(), password = FleetFixture.Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var updated = await login.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(name, updated.GetProperty("id").GetString());
        Assert.Equal(email, updated.GetProperty("email").GetString());
        using var byEmail = await Anonymous();
        Assert.Equal(HttpStatusCode.OK, (await byEmail.PostAsJsonAsync("/api/v1/auth/login", new { email, password = FleetFixture.Password })).StatusCode);
    }

    [Fact]
    public async Task Case_insensitive_username_uniqueness_is_enforced_during_concurrent_registrations()
    {
        using var first = await Anonymous();
        using var second = await Anonymous();
        var name = $"same-{Guid.NewGuid():N}";
        var responses = await Task.WhenAll(first.PostAsJsonAsync("/api/v1/auth/register", Registration(name)), second.PostAsJsonAsync("/api/v1/auth/register", Registration(name.ToUpperInvariant())));
        Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Created);
        var rejected = Assert.Single(responses, x => x.StatusCode == HttpStatusCode.BadRequest);
        Assert.True((await rejected.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("userName", out _));
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        Assert.Equal(1, await db.Users.CountAsync(x => x.Id == name));
        Assert.Equal(1, await db.UserIdentityHistory.CountAsync(x => x.PreviousId == name));
        Assert.Equal(1, await db.SystemAuditEvents.CountAsync(x => x.ActorSubject == name && x.Action == "user.registered"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("ab")]
    [InlineData("árvíztűrő")]
    [InlineData("two words")]
    [InlineData("a/b")]
    [InlineData(".first")]
    [InlineData("email@example.test")]
    [InlineData("bootstrap:database-operator")]
    public async Task Invalid_names_are_rejected_without_creating_an_account(string? name)
    {
        using var client = await Anonymous();
        var response = await client.PostAsJsonAsync("/api/v1/auth/register", Registration(name!));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("userName", out _));
    }

    [Fact]
    public async Task Database_rejects_primary_key_renaming_and_legacy_subject_reuse()
    {
        using var client = await Anonymous();
        var name = $"permanent-{Guid.NewGuid():N}";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/auth/register", Registration(name))).StatusCode);
        await using var connection = new NpgsqlConnection(fixture.ApplicationConnection);
        await connection.OpenAsync();
        await using (var rename = new NpgsqlCommand("UPDATE identity_users SET \"Id\" = 'another-name', \"UserName\" = 'another-name', \"NormalizedUserName\" = 'ANOTHER-NAME' WHERE \"Id\" = @name", connection))
        {
            rename.Parameters.AddWithValue("name", name);
            Assert.Equal("23514", (await Assert.ThrowsAsync<PostgresException>(() => rename.ExecuteNonQueryAsync())).SqlState);
        }
        var reserved = $"orphan-{Guid.NewGuid():N}";
        await using (var reserve = new NpgsqlCommand("INSERT INTO user_identity_history (\"PreviousId\", \"UserId\") VALUES (@name, NULL)", connection))
        { reserve.Parameters.AddWithValue("name", reserved); await reserve.ExecuteNonQueryAsync(); }
        using var stranger = await Anonymous();
        Assert.Equal(HttpStatusCode.BadRequest, (await stranger.PostAsJsonAsync("/api/v1/auth/register", Registration(reserved))).StatusCode);
        await using var erase = new NpgsqlCommand("DELETE FROM user_identity_history WHERE \"PreviousId\" = @name", connection);
        erase.Parameters.AddWithValue("name", reserved);
        Assert.Equal("55000", (await Assert.ThrowsAsync<PostgresException>(() => erase.ExecuteNonQueryAsync())).SqlState);
    }
}
