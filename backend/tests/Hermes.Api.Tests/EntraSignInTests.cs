using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Hermes.Api;
using Hermes.Domain;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace Hermes.Api.Tests;

public sealed class EntraSignInTests(FleetFixture fixture) : IClassFixture<FleetFixture>
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid ClientId = Guid.NewGuid();
    private const string Callback = "/api/v1/auth/entra/callback";
    private const string Root = "/api/v1/auth/entra";

    [Fact]
    public async Task DisabledConfigurationKeepsPasswordSignInAndHidesEntra()
    {
        using var client = await fixture.ClientAsync();
        var options = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/options");
        Assert.False(options.GetProperty("entraEnabled").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync(Root + "/login", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/session")).StatusCode);
    }

    [Fact]
    public async Task ConnectAndLoginUseValidatedIdentityAndExistingCompanyAccess()
    {
        using var provider = new TestProvider();
        using var factory = EnabledFactory(provider);
        using var signedOut = CreateClient(factory);
        using var bela = CreateClient(factory);
        await FleetFixture.RefreshCsrfAsync(bela);
        (await bela.PostAsJsonAsync("/api/v1/auth/login", new { userName = "bela", password = FleetFixture.Password })).EnsureSuccessStatusCode();
        await FleetFixture.RefreshCsrfAsync(bela);
        var options = await signedOut.GetFromJsonAsync<JsonElement>("/api/v1/auth/options");
        Assert.True(options.GetProperty("entraEnabled").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await signedOut.PostAsync(Root + "/login", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await bela.PostAsJsonAsync(Root + "/connect", new { password = "wrong" })).StatusCode);

        await FleetFixture.RefreshCsrfAsync(signedOut);
        Assert.Equal("/?entra=unlinked", await Complete(signedOut, await signedOut.PostAsync(Root + "/login", null), provider));
        Assert.Equal(HttpStatusCode.Unauthorized, (await signedOut.GetAsync("/api/v1/auth/session")).StatusCode);

        var connect = await bela.PostAsJsonAsync(Root + "/connect", new { password = FleetFixture.Password });
        Assert.Equal("/?entra=connected", await Complete(bela, connect, provider));
        Assert.True((await bela.GetFromJsonAsync<JsonElement>(Root + "/connection")).GetProperty("linked").GetBoolean());

        Assert.Equal("/?entra=failed", await Complete(signedOut, await signedOut.PostAsync(Root + "/login", null), provider, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await signedOut.GetAsync("/api/v1/auth/session")).StatusCode);
        Assert.Equal("/?entra=signed-in", await Complete(signedOut, await signedOut.PostAsync(Root + "/login", null), provider));
        var session = await signedOut.GetFromJsonAsync<SessionResponse>("/api/v1/auth/session");
        Assert.Equal("bela", session!.Id);
        Assert.Empty(session.SystemPermissions);
        var companies = await signedOut.GetFromJsonAsync<JsonElement>("/api/v1/tenants");
        Assert.Contains(companies.EnumerateArray(), item => item.GetProperty("id").GetGuid() == TestFleetData.DunaId);
        Assert.DoesNotContain(companies.EnumerateArray(), item => item.GetProperty("id").GetGuid() == TestFleetData.PannonId);

        Assert.Equal(HttpStatusCode.NoContent, (await bela.DeleteAsync(Root + "/connection")).StatusCode);
        Assert.False((await bela.GetFromJsonAsync<JsonElement>(Root + "/connection")).GetProperty("linked").GetBoolean());
        using var nextLogin = CreateClient(factory);
        await FleetFixture.RefreshCsrfAsync(nextLogin);
        Assert.Equal("/?entra=unlinked", await Complete(nextLogin, await nextLogin.PostAsync(Root + "/login", null), provider));
    }

    private WebApplicationFactory<Program> EnabledFactory(TestProvider provider) =>
        fixture.Factory.WithWebHostBuilder(builder => builder
            .UseSetting("Entra:Enabled", "true").UseSetting("Entra:TenantId", TenantId.ToString())
            .UseSetting("Entra:ClientId", ClientId.ToString()).UseSetting("Entra:ClientSecret", "local-test-only")
            .ConfigureServices(services => services.PostConfigure<OpenIdConnectOptions>("MicrosoftEntra", options =>
            {
                options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(provider.Configuration);
                options.Backchannel = new HttpClient(provider, disposeHandler: false);
            })));

    private static HttpClient CreateClient(WebApplicationFactory<Program> factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new("https://localhost"), AllowAutoRedirect = false });

    private static async Task<string?> Complete(HttpClient client, HttpResponseMessage challenge, TestProvider provider, Guid? tokenTenant = null)
    {
        challenge.EnsureSuccessStatusCode();
        var body = await challenge.Content.ReadFromJsonAsync<JsonElement>();
        var url = new Uri(body.GetProperty("url").GetString()!);
        Assert.Equal("login.microsoftonline.com", url.Host);
        var query = QueryHelpers.ParseQuery(url.Query);
        Assert.Equal("code", query["response_type"]);
        Assert.Equal("S256", query["code_challenge_method"]);
        Assert.Equal("https://localhost" + Callback, query["redirect_uri"]);
        Assert.False(string.IsNullOrEmpty(query["state"]));
        provider.IssueToken(query["nonce"].ToString(), tokenTenant ?? TenantId, query["code_challenge"].ToString());
        var response = await client.GetAsync(QueryHelpers.AddQueryString(Callback, new Dictionary<string, string?>
        { ["code"] = "test-code", ["state"] = query["state"] }));
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        return response.Headers.Location?.OriginalString;
    }

    private sealed class TestProvider : HttpMessageHandler
    {
        private readonly RSA rsa = RSA.Create(2048);
        private readonly Guid objectId = Guid.NewGuid();
        private string token = "";
        private string challenge = "";
        private const string Issuer = "https://login.microsoftonline.com/";
        public OpenIdConnectConfiguration Configuration { get; }

        public TestProvider()
        {
            Configuration = new OpenIdConnectConfiguration
            {
                Issuer = $"{Issuer}{TenantId:D}/v2.0",
                AuthorizationEndpoint = $"{Issuer}{TenantId:D}/oauth2/v2.0/authorize",
                TokenEndpoint = $"{Issuer}{TenantId:D}/oauth2/v2.0/token",
            };
            Configuration.SigningKeys.Add(new RsaSecurityKey(rsa) { KeyId = "test-key" });
        }

        public void IssueToken(string nonce, Guid tenant, string codeChallenge)
        {
            challenge = codeChallenge;
            var signing = new SigningCredentials(Configuration.SigningKeys.Single(), SecurityAlgorithms.RsaSha256);
            // The mailbox matches another user. Only the linked Entra object may identify the local account.
            token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(Configuration.Issuer, ClientId.ToString(),
                [new("sub", "provider-subject"), new("oid", objectId.ToString()), new("tid", tenant.ToString()),
                    new("preferred_username", "anna@example.test"), new("email", "anna@example.test"), new("nonce", nonce),
                    new("roles", "system.manage"), new("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)],
                DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddMinutes(15), signing));
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal(Configuration.TokenEndpoint, request.RequestUri!.ToString());
            var form = QueryHelpers.ParseQuery(await request.Content!.ReadAsStringAsync(cancellationToken));
            var verifier = System.Text.Encoding.ASCII.GetBytes(form["code_verifier"].ToString());
            Assert.Equal(challenge, Base64UrlEncoder.Encode(SHA256.HashData(verifier)));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { id_token = token, access_token = "test-only", token_type = "Bearer" }) };
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) rsa.Dispose();
            base.Dispose(disposing);
        }
    }
}
