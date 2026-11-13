using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class AccountFlowTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private sealed record UserResponse(string Id, string DisplayName, string Email);
    private static string NewEmail() => $"user-{Guid.NewGuid():N}@example.test";
    private static string NewUserName() => $"user-{Guid.NewGuid():N}";

    [Fact]
    public async Task Health_version_identifies_the_actual_running_build_without_secrets()
    {
        using var client = await fixture.ClientAsync(null);
        var response = await client.GetFromJsonAsync<JsonElement>("/health/version");
        Assert.Equal("Hermes.Api", response.GetProperty("service").GetString());
        Assert.Equal(Environment.ProcessId, response.GetProperty("processId").GetInt32());
        Assert.True(response.GetProperty("startedAt").GetDateTimeOffset() <= DateTimeOffset.UtcNow);
        Assert.False(string.IsNullOrWhiteSpace(response.GetProperty("version").GetString()));
        Assert.False(response.TryGetProperty("connectionString", out _));
        Assert.DoesNotContain(FleetFixture.Password, response.ToString());
    }

    private async Task<(HttpClient Client, UserResponse User)> RegisterAsync(string? email = null)
    {
        var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        var response = await fixture.RegisterAsync(new { displayName = "Teszt Felhasználó", email = email ?? NewEmail(), password = FleetFixture.Password, userName = NewUserName() });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var user = await response.Content.ReadFromJsonAsync<UserResponse>();
        await FleetFixture.SignInAsync(client, user!.Id);
        return (client, user);
    }

    [Fact]
    public async Task Registration_requires_system_access_and_does_not_change_sessions()
    {
        using var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        var email = NewEmail();
        var id = NewUserName();
        var input = new { displayName = "Új Felhasználó", email, password = FleetFixture.Password, userName = id };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/register", input)).StatusCode);
        using var ordinary = await fixture.ClientAsync("bela");
        Assert.Equal(HttpStatusCode.Forbidden, (await ordinary.PostAsJsonAsync("/api/v1/auth/register", input)).StatusCode);
        using var registrar = await fixture.ClientAsync("test.registrar");
        var registration = await registrar.PostAsJsonAsync("/api/v1/auth/register", input);
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        Assert.Equal("test.registrar", (await registrar.GetFromJsonAsync<UserResponse>("/api/v1/auth/session"))!.Id);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/session")).StatusCode);
        await FleetFixture.SignInAsync(client, id);
        var session = await client.GetFromJsonAsync<UserResponse>("/api/v1/auth/session");
        Assert.Equal(email, session!.Email);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new Infrastructure.TenantContext());
        var stored = await db.Users.SingleAsync(user => user.Id == session.Id);
        Assert.NotNull(stored.PasswordHash);
        Assert.NotEqual(FleetFixture.Password, stored.PasswordHash);
        Assert.Empty((await client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
    }

    [Fact]
    public async Task Logout_removes_access_and_the_same_account_can_log_in_again()
    {
        var (client, user) = await RegisterAsync();
        using (client)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/v1/auth/logout", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/tenants")).StatusCode);
            await FleetFixture.RefreshCsrfAsync(client);
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email.ToUpperInvariant(), password = FleetFixture.Password })).StatusCode);
            Assert.Equal(user.Id, (await client.GetFromJsonAsync<UserResponse>("/api/v1/auth/session"))!.Id);
        }
    }

    [Fact]
    public async Task A_user_can_create_multiple_companies_with_bootstrap_permissions()
    {
        var (client, user) = await RegisterAsync();
        using (client)
        {
            var first = await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Első cég", role = "Viewer", userSubject = "bela" });
            var second = await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Második cég" });
            Assert.Equal(HttpStatusCode.Created, first.StatusCode);
            Assert.Equal(HttpStatusCode.Created, second.StatusCode);
            var tenants = await client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants");
            Assert.Equal(2, tenants!.Length);
            Assert.All(tenants, tenant => Assert.Equal(Permissions.All.Order(), tenant.Permissions.Order()));
            await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new Infrastructure.TenantContext());
            var memberships = await db.Memberships.Where(membership => membership.UserSubject == user.Id).ToListAsync();
            Assert.Equal(2, memberships.Count);
            client.DefaultRequestHeaders.Add("X-Tenant-Id", tenants[0].Id.ToString());
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/vehicles", new CreateVehicleRequest("OWN-123", "Ford", "Focus"))).StatusCode);
            client.DefaultRequestHeaders.Remove("X-Tenant-Id");
            client.DefaultRequestHeaders.Add("X-Tenant-Id", tenants[1].Id.ToString());
            Assert.Empty((await client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!);
        }
    }

    [Fact]
    public async Task A_new_account_cannot_join_existing_companies_by_name_or_tenant_header()
    {
        var (client, _) = await RegisterAsync();
        using (client)
        {
            client.DefaultRequestHeaders.Add("X-Tenant-Id", TestFleetData.DunaId.ToString());
            Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/vehicles")).StatusCode);
            Assert.Empty((await client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!);
            var own = await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Duna Logisztika", id = TestFleetData.DunaId });
            var created = await own.Content.ReadFromJsonAsync<TenantSummary>();
            Assert.Equal(HttpStatusCode.Created, own.StatusCode);
            Assert.NotEqual(TestFleetData.DunaId, created!.Id);
        }
    }

    [Fact]
    public async Task Registration_and_authenticated_writes_require_csrf_tokens()
    {
        using var registrar = await fixture.ClientAsync("test.registrar");
        registrar.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await registrar.PostAsJsonAsync("/api/v1/auth/register", new { displayName = "Teszt", email = NewEmail(), password = FleetFixture.Password })).StatusCode);
        var (client, _) = await RegisterAsync();
        using (client)
        {
            client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Tiltott kérés" })).StatusCode);
        }
    }

    [Fact]
    public async Task Anonymous_csrf_tokens_cannot_be_reused_after_authentication()
    {
        using var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { userName = "anna", password = FleetFixture.Password })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Elavult token" })).StatusCode);
        await FleetFixture.RefreshCsrfAsync(client);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Friss token" })).StatusCode);
    }

    [Fact]
    public async Task Duplicate_email_is_case_insensitively_rejected_even_during_concurrent_registration()
    {
        var email = NewEmail();
        using var first = await fixture.ClientAsync(null);
        using var second = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(first);
        await FleetFixture.RefreshCsrfAsync(second);
        var responses = await Task.WhenAll(
            fixture.RegisterAsync(new { displayName = "Egy", email, password = FleetFixture.Password, userName = NewUserName() }),
            fixture.RegisterAsync(new { displayName = "Kettő", email = email.ToUpperInvariant(), password = FleetFixture.Password, userName = NewUserName() }));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.BadRequest);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("")]
    [InlineData("            ")]
    public async Task Weak_passwords_do_not_create_an_account(string password)
    {
        using var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        Assert.Equal(HttpStatusCode.BadRequest, (await fixture.RegisterAsync(new { displayName = "Teszt", email = NewEmail(), password, userName = NewUserName() })).StatusCode);
    }

    [Fact]
    public async Task Login_failures_do_not_disclose_whether_an_email_is_registered()
    {
        using var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        var known = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "anna@example.test", password = "wrong-password" });
        var unknown = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = NewEmail(), password = "wrong-password" });
        Assert.Equal(HttpStatusCode.Unauthorized, known.StatusCode);
        var knownProblem = await known.Content.ReadFromJsonAsync<JsonElement>();
        var unknownProblem = await unknown.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(knownProblem.GetProperty("title").GetString(), unknownProblem.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Repeated_wrong_passwords_lock_the_account_temporarily()
    {
        var (registered, user) = await RegisterAsync();
        registered.Dispose();
        using var client = await fixture.ClientAsync(null);
        await FleetFixture.RefreshCsrfAsync(client);
        for (var attempt = 0; attempt < 5; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = "wrong-password" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email = user.Email, password = FleetFixture.Password })).StatusCode);
    }

    [Fact]
    public async Task Account_endpoints_are_rate_limited()
    {
        await using var factory = fixture.CreateFactory().WithWebHostBuilder(builder => builder.UseSetting("Security:AccountPermitLimit", "1"));
        using var client = factory.CreateClient();
        await FleetFixture.RefreshCsrfAsync(client);
        var input = new { email = NewEmail(), password = "wrong-password" };
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", input)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/v1/auth/login", input)).StatusCode);
    }

    [Fact]
    public async Task Production_session_cookies_are_secure_and_http_only()
    {
        await using var factory = fixture.CreateFactory("Production");
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        await FleetFixture.RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "bela@example.test", password = FleetFixture.Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"), value => value.StartsWith("Hermes.Session="));
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
    }
}
