using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Api;
using Hermes.Application;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class AccountRecoveryTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private sealed class Mailbox : IEmailTransport
    {
        public ConcurrentQueue<EmailMessage> Messages { get; } = new();
        public bool Fail { get; set; }
        public Task Send(EmailMessage message, CancellationToken ct)
        {
            if (Fail) throw new IOException("Simulated transport failure");
            Messages.Enqueue(message);
            return Task.CompletedTask;
        }
    }

    private WebApplicationFactory<Program> Factory(Mailbox mailbox, bool confirmation = false, string environment = "Development")
        => fixture.CreateFactory(environment).WithWebHostBuilder(builder => builder
            .UseSetting("Email:Mode", "Smtp").UseSetting("Email:Host", "mail.example.test")
            .UseSetting("Email:FromAddress", "hermes@example.test").UseSetting("Email:PublicBaseUrl", "https://fleet.example.test")
            .UseSetting("AllowedHosts", "*")
            .UseSetting("Accounts:RequireEmailConfirmation", confirmation.ToString())
            .ConfigureServices(services => services.AddSingleton<IEmailTransport>(mailbox)));

    private static HttpClient Client(WebApplicationFactory<Program> factory) => factory.CreateClient(new()
    { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    private async Task<(string Id, string Email)> Register(HttpClient client, WebApplicationFactory<Program> factory, bool confirmation = false)
    {
        await FleetFixture.RefreshCsrfAsync(client);
        var id = $"recovery-{Guid.NewGuid():N}";
        var email = $"{id}@example.test";
        var response = await fixture.RegisterAsync(new { userName = id, email, displayName = "Levél teszt", password = FleetFixture.Password }, factory);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        if (!confirmation) await FleetFixture.SignInAsync(client, id);
        return (id, email);
    }
    private static Uri Link(EmailMessage message) => new(message.Text.Split('\n').Single(x => x.StartsWith("https://", StringComparison.Ordinal)));
    private static AccountTokenRequest Token(EmailMessage message)
    {
        var url = Link(message);
        Assert.Equal("fleet.example.test", url.Host);
        Assert.Equal("", url.Query);
        var query = QueryHelpers.ParseQuery(url.Fragment[(url.Fragment.IndexOf('?') + 1)..]);
        return new(query["userId"].ToString(), query["email"].ToString(), query["token"].ToString());
    }

    [Fact]
    public async Task Confirmation_blocks_only_new_accounts_until_the_single_use_link_is_confirmed()
    {
        var mail = new Mailbox();
        await using var factory = Factory(mail, confirmation: true);
        using var client = Client(factory);
        client.DefaultRequestHeaders.Host = "untrusted.example.test";
        var (id, email) = await Register(client, factory, confirmation: true);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = FleetFixture.Password })).StatusCode);
        var token = Token(Assert.Single(mail.Messages));
        Assert.Equal(id, token.UserId);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/confirm-email", token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/confirm-email", token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = FleetFixture.Password })).StatusCode);
        using var legacy = Client(factory);
        await FleetFixture.RefreshCsrfAsync(legacy);
        Assert.Equal(HttpStatusCode.OK, (await legacy.PostAsJsonAsync("/api/v1/auth/login", new { email = "anna@example.test", password = FleetFixture.Password })).StatusCode);
    }

    [Fact]
    public async Task Reset_invalidates_old_sessions_and_token_but_preserves_company_access()
    {
        var mail = new Mailbox();
        await using var factory = Factory(mail);
        using var original = Client(factory);
        var (id, email) = await Register(original, factory);
        var company = await original.PostAsJsonAsync("/api/v1/tenants", new { name = "Jelszó tesztcég" });
        Assert.Equal(HttpStatusCode.Created, company.StatusCode);
        var access = await original.GetStringAsync("/api/v1/tenants");
        using var anonymous = Client(factory);
        await FleetFixture.RefreshCsrfAsync(anonymous);
        var requested = await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email });
        Assert.Equal(HttpStatusCode.Accepted, requested.StatusCode);
        var token = Token(Assert.Single(mail.Messages));
        var reset = new ResetPasswordRequest(id, email, token.Token, "New-test-passphrase-123", "New-test-passphrase-123");
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await original.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = FleetFixture.Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/v1/auth/login", new { email, password = reset.NewPassword })).StatusCode);
        Assert.Equal(access, await anonymous.GetStringAsync("/api/v1/tenants"));
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext());
        var audit = await db.SystemAuditEvents.Where(x => x.TargetSubject == id).Select(x => x.Details).ToArrayAsync();
        Assert.DoesNotContain(audit, x => x.Contains(token.Token) || x.Contains(reset.NewPassword));
    }

    [Fact]
    public async Task Requests_are_generic_throttled_per_account_and_do_not_send_for_unknown_accounts()
    {
        var mail = new Mailbox();
        await using var factory = Factory(mail);
        using var client = Client(factory);
        var (_, email) = await Register(client, factory);
        var valid = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email });
        var unknown = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = "unknown@example.test" });
        var repeated = await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email });
        Assert.Equal(HttpStatusCode.Accepted, valid.StatusCode);
        Assert.Equal(await valid.Content.ReadAsStringAsync(), await unknown.Content.ReadAsStringAsync());
        Assert.Equal(await valid.Content.ReadAsStringAsync(), await repeated.Content.ReadAsStringAsync());
        Assert.Single(mail.Messages);
    }

    [Fact]
    public async Task Tokens_are_bound_to_user_email_and_purpose_and_weak_or_mismatching_passwords_are_rejected()
    {
        var mail = new Mailbox();
        await using var factory = Factory(mail);
        using var client = Client(factory);
        var (_, email) = await Register(client, factory);
        await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email });
        var token = Token(Assert.Single(mail.Messages));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/confirm-email", token)).StatusCode);
        var request = new ResetPasswordRequest(token.UserId, email, token.Token, "New-test-passphrase-123", "New-test-passphrase-123");
        foreach (var invalid in new[] { request with { Email = "other@example.test" }, request with { UserId = "anna" },
                     request with { Token = "invalid" }, request with { NewPassword = "short", ConfirmPassword = "short" }, request with { ConfirmPassword = "different" } })
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", invalid)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/reset-password", request)).StatusCode);
    }

    [Fact]
    public async Task Expired_reset_and_confirmation_tokens_are_rejected()
    {
        var mail = new Mailbox();
        await using var factory = Factory(mail, confirmation: true).WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.Configure<DataProtectionTokenProviderOptions>(options => options.TokenLifespan = TimeSpan.FromSeconds(-1));
            services.Configure<EmailConfirmationTokenOptions>(options => options.TokenLifespan = TimeSpan.FromSeconds(-1));
        }));
        using var client = Client(factory);
        await Register(client, factory, confirmation: true);
        var token = Token(Assert.Single(mail.Messages));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/confirm-email", token)).StatusCode);
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByIdAsync(token.UserId);
        var resetToken = await users.GeneratePasswordResetTokenAsync(user!);
        var encoded = WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(resetToken));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/reset-password",
            new ResetPasswordRequest(token.UserId, token.Email, encoded, "New-test-passphrase-123", "New-test-passphrase-123"))).StatusCode);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task Archived_and_production_development_only_accounts_cannot_recover(bool archived, bool developmentOnly)
    {
        var mail = new Mailbox();
        await using var factory = Factory(mail);
        using var client = Client(factory);
        var (id, email) = await Register(client, factory);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HermesDbContext>();
            db.AccountLifecycles.Add(new() { UserId = id, IsArchived = archived, DevelopmentOnly = developmentOnly });
            await db.SaveChangesAsync();
        }
        await using var production = Factory(mail, environment: "Production");
        using var visitor = Client(production);
        await FleetFixture.RefreshCsrfAsync(visitor);
        Assert.Equal(HttpStatusCode.Accepted, (await visitor.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email })).StatusCode);
        Assert.Empty(mail.Messages);
        Assert.Equal(HttpStatusCode.BadRequest, (await visitor.PostAsJsonAsync("/api/v1/auth/reset-password",
            new ResetPasswordRequest(id, email, "invalid", "New-test-passphrase-123", "New-test-passphrase-123"))).StatusCode);
    }

    [Theory]
    [InlineData(false, "sent")]
    [InlineData(true, "failed")]
    public async Task Invitations_send_after_commit_and_transport_failure_keeps_the_manual_link(bool failure, string delivery)
    {
        var mail = new Mailbox { Fail = failure };
        await using var factory = Factory(mail);
        using var client = Client(factory);
        await Register(client, factory);
        var company = (await (await client.PostAsJsonAsync("/api/v1/tenants", new { name = "Meghívó tesztcég" })).Content.ReadFromJsonAsync<TenantSummary>())!;
        client.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        var response = await client.PostAsJsonAsync("/api/v1/invitations", new { email = "invitee@example.test", permissions = new[] { "vehicles.read" } });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(delivery, body.GetProperty("emailDelivery").GetString());
        var acceptance = body.GetProperty("acceptance").Deserialize<AcceptInvitationRequest>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        if (!failure)
        {
            var message = Assert.Single(mail.Messages);
            Assert.Equal("invitee@example.test", message.Recipient);
            var fragment = QueryHelpers.ParseQuery(Link(message).Fragment.TrimStart('#'));
            Assert.Equal("1", fragment["invite"].ToString());
            Assert.Equal(acceptance.Token, fragment["token"].ToString());
        }
        var list = await client.GetFromJsonAsync<PageResult<InvitationSummary>>("/api/v1/invitations");
        Assert.Equal(acceptance.InvitationId, Assert.Single(list!.Items).Id);
        // A stranger cannot cause an invitation email in this company.
        using var stranger = Client(factory);
        await Register(stranger, factory);
        stranger.DefaultRequestHeaders.Add("X-Tenant-Id", company.Id.ToString());
        var count = mail.Messages.Count;
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.PostAsJsonAsync("/api/v1/invitations", new { email = "other@example.test", permissions = Array.Empty<string>() })).StatusCode);
        Assert.Equal(count, mail.Messages.Count);
    }

    [Fact]
    public async Task Disabled_delivery_is_explicit_and_recovery_requires_csrf()
    {
        using var client = await fixture.ClientAsync(null);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = "anna@example.test" })).StatusCode);
        await FleetFixture.RefreshCsrfAsync(client);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = "anna@example.test" })).StatusCode);
    }
}
