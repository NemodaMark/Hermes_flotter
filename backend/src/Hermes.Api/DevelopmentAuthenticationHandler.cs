using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Hermes.Api;

public sealed class DevelopmentAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Development";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var name = Request.Headers["X-Development-User"].ToString();
        if (string.IsNullOrEmpty(name)) return Task.FromResult(AuthenticateResult.NoResult());
        if (name is not ("anna" or "bela"))
            return Task.FromResult(AuthenticateResult.Fail("Unknown development identity."));

        var identity = new ClaimsIdentity([
            new Claim("sub", $"development:{name}"),
            new Claim(ClaimTypes.Name, name == "anna" ? "Kovács Anna" : "Nagy Béla")
        ], SchemeName);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)));
    }
}
