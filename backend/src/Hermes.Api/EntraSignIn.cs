using System.Security.Claims;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Hermes.Api;

internal sealed record EntraOptions(bool Enabled, Guid TenantId);
internal sealed record EntraConnectRequest(string? Password);

public static class EntraSignIn
{
    internal const string Scheme = "MicrosoftEntra";
    internal const string CallbackPath = "/api/v1/auth/entra/callback";
    private const string LinkUser = "hermes.link-user";

    public static void AddEntraSignIn(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection("Entra");
        var enabled = section.GetValue<bool>("Enabled");
        Guid.TryParse(section["TenantId"], out var tenantId);
        Guid.TryParse(section["ClientId"], out var clientId);
        var secret = section["ClientSecret"] ?? "";
        if (enabled && (tenantId == Guid.Empty || clientId == Guid.Empty || string.IsNullOrWhiteSpace(secret)))
            throw new InvalidOperationException("Entra requires TenantId, ClientId and ClientSecret.");
        services.AddSingleton(new EntraOptions(enabled, tenantId));
        if (!enabled) return;

        services.AddAuthentication().AddOpenIdConnect(Scheme, options =>
        {
            options.Authority = $"https://login.microsoftonline.com/{tenantId:D}/v2.0";
            options.ClientId = clientId.ToString("D");
            options.ClientSecret = secret;
            options.SignInScheme = IdentityConstants.ExternalScheme;
            options.CallbackPath = CallbackPath;
            options.ResponseType = OpenIdConnectResponseType.Code;
            options.ResponseMode = OpenIdConnectResponseMode.Query;
            options.Prompt = "select_account";
            options.UsePkce = true;
            options.MapInboundClaims = false;
            options.SaveTokens = false;
            options.PushedAuthorizationBehavior = PushedAuthorizationBehavior.Disable;
            options.Events.OnTicketReceived = Complete;
            options.Events.OnRemoteFailure = context =>
            {
                context.HandleResponse();
                context.Response.Headers.CacheControl = "no-store";
                context.Response.Redirect("/?entra=failed");
                return Task.CompletedTask;
            };
        });
    }

    public static void MapEntraSignIn(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/auth/entra").RequireRateLimiting("accounts").WithMetadata(new PasswordChangeAllowed());
        group.MapPost("/login", async (HttpContext context, EntraOptions options) =>
        {
            if (!Available(context, options)) return Results.NotFound();
            if (context.User.Identity?.IsAuthenticated == true) return Results.Conflict();
            return await Begin(context, new AuthenticationProperties());
        }).AllowAnonymous();
        group.MapPost("/connect", async (EntraConnectRequest request, HttpContext context, EntraOptions options,
            UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn) =>
        {
            if (!Available(context, options)) return Results.NotFound();
            var user = await users.GetUserAsync(context.User);
            if (user is null || user.PasswordChangeRequired) return Results.Forbid();
            if (request.Password is not { Length: > 0 and <= 128 } ||
                !(await signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true)).Succeeded)
                return Results.Problem(statusCode: 400, title: "A HERMES-jelszó nem igazolható.");
            var properties = new AuthenticationProperties();
            properties.Items[LinkUser] = user.Id;
            return await Begin(context, properties);
        }).RequireAuthorization();
        group.MapGet("/connection", async (HttpContext context, EntraOptions options, UserManager<ApplicationUser> users) =>
        {
            var user = await users.GetUserAsync(context.User);
            if (user is null) return Results.Unauthorized();
            var linked = (await users.GetLoginsAsync(user)).Any(login => login.LoginProvider == Scheme);
            return Results.Ok(new { enabled = Available(context, options), linked });
        }).RequireAuthorization();
        group.MapDelete("/connection", async (HttpContext context, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, HermesDbContext db) =>
        {
            var ct = context.RequestAborted;
            var user = await users.GetUserAsync(context.User);
            if (user is null) return Results.Unauthorized();
            if (user.PasswordChangeRequired || !await users.HasPasswordAsync(user)) return Results.Forbid();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await LockUser(db, user.Id, ct);
            var existing = (await users.GetLoginsAsync(user)).SingleOrDefault(login => login.LoginProvider == Scheme);
            if (existing is null) return Results.NoContent();
            if (!(await users.RemoveLoginAsync(user, Scheme, existing.ProviderKey)).Succeeded) return Results.Conflict();
            UserAccounts.Audit(db, user.Id, user.Id, "user.entra.disconnected", new { provider = Scheme });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            await transaction.DisposeAsync();
            await signIn.RefreshSignInAsync(user);
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static bool Available(HttpContext context, EntraOptions options) => options.Enabled && context.Request.IsHttps;

    private static async Task<IResult> Begin(HttpContext context, AuthenticationProperties properties)
    {
        await context.ChallengeAsync(Scheme, properties);
        // The handler generates the protected state, PKCE challenge and cookies before issuing the redirect.
        var url = context.Response.Headers.Location.ToString();
        context.Response.Headers.Remove("Location");
        return Uri.TryCreate(url, UriKind.Absolute, out var destination) && destination.Scheme == Uri.UriSchemeHttps
            && destination.Host == "login.microsoftonline.com"
            ? Results.Ok(new { url })
            : Results.Problem(statusCode: 503, title: "A Microsoft-bejelentkezés jelenleg nem érhető el.");
    }

    internal static string? ProviderKey(ClaimsPrincipal? principal, Guid tenantId)
        => Guid.TryParse(principal?.FindFirstValue("tid"), out var tid) && tid == tenantId
            && Guid.TryParse(principal?.FindFirstValue("oid"), out var oid) && oid != Guid.Empty
            ? $"{tid:D}:{oid:D}" : null;

    private static Task LockUser(HermesDbContext db, string userId, CancellationToken ct)
        => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({userId}, 171840121))", ct);

    private static async Task Complete(TicketReceivedContext context)
    {
        context.HandleResponse();
        context.Response.Headers.CacheControl = "no-store";
        var services = context.HttpContext.RequestServices;
        var options = services.GetRequiredService<EntraOptions>();
        var users = services.GetRequiredService<UserManager<ApplicationUser>>();
        var signIn = services.GetRequiredService<SignInManager<ApplicationUser>>();
        var db = services.GetRequiredService<HermesDbContext>();
        var development = services.GetRequiredService<IWebHostEnvironment>().IsDevelopment();
        var ct = context.HttpContext.RequestAborted;
        var key = ProviderKey(context.Principal, options.TenantId);
        var result = "failed";
        if (key is not null && context.Request.IsHttps)
        {
            var session = await context.HttpContext.AuthenticateAsync(IdentityConstants.ApplicationScheme);
            if (context.Properties?.Items.TryGetValue(LinkUser, out var actorId) == true)
            {
                var actor = session.Principal is null ? null : await users.GetUserAsync(session.Principal);
                if (actor is not null && actor.Id == actorId && !actor.PasswordChangeRequired &&
                    await Eligible(actor, users, db, development, ct) && await Connect(actor, key, users, db, ct))
                    result = "connected";
            }
            else if (!session.Succeeded)
            {
                var user = await users.FindByLoginAsync(Scheme, key);
                if (user is not null && await Eligible(user, users, db, development, ct))
                {
                    await signIn.SignInAsync(user, isPersistent: false, authenticationMethod: Scheme);
                    result = "signed-in";
                }
                else if (user is null) result = "unlinked";
            }
        }
        context.Response.Redirect($"/?entra={result}");
    }

    private static async Task<bool> Eligible(ApplicationUser user, UserManager<ApplicationUser> users, HermesDbContext db, bool development, CancellationToken ct)
        => (!user.EmailConfirmationRequired || user.EmailConfirmed) && !await users.IsLockedOutAsync(user)
            && !await db.AccountLifecycles.AnyAsync(x => x.UserId == user.Id && (x.IsArchived || (!development && x.DevelopmentOnly)), ct);

    private static async Task<bool> Connect(ApplicationUser user, string key, UserManager<ApplicationUser> users, HermesDbContext db, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockUser(db, user.Id, ct);
        var logins = await users.GetLoginsAsync(user);
        if (logins.Any(login => login.LoginProvider == Scheme && login.ProviderKey == key)) return true;
        if (logins.Any(login => login.LoginProvider == Scheme) || await users.FindByLoginAsync(Scheme, key) is not null) return false;
        // The Identity login primary key arbitrates simultaneous requests from different accounts.
        try
        {
            if (!(await users.AddLoginAsync(user, new UserLoginInfo(Scheme, key, "Microsoft Entra ID"))).Succeeded) return false;
            UserAccounts.Audit(db, user.Id, user.Id, "user.entra.connected", new { provider = Scheme });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return true;
        }
        catch (DbUpdateException error) when (error.InnerException is Npgsql.PostgresException
            { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation, ConstraintName: "PK_identity_user_logins" })
        {
            return false;
        }
    }
}
