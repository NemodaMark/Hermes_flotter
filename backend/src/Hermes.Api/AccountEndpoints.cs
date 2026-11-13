using System.ComponentModel.DataAnnotations;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Hermes.Api;

public sealed record RegisterRequest(string DisplayName, string Email, string? Password, string UserName, Guid? EntraObjectId = null);
public sealed record LoginRequest(string? Email, string Password, string? UserName = null);
public sealed record SessionResponse(string Id, string DisplayName, string Email, bool PasswordChangeRequired, string[] SystemPermissions);
public sealed record UpdateProfileRequest(string DisplayName);

public static class AccountEndpoints
{
    public static void MapAccountEndpoints(this WebApplication app)
    {
        var accounts = app.MapGroup("/api/v1/auth");
        accounts.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery) =>
            Results.Ok(new { requestToken = antiforgery.GetAndStoreTokens(context).RequestToken })).AllowAnonymous().WithMetadata(new PasswordChangeAllowed());

        accounts.MapGet("/session", async (HttpContext context, UserManager<ApplicationUser> users, UserAccounts accounts, CancellationToken ct) =>
        {
            var user = await users.GetUserAsync(context.User);
            return user is null ? Results.Unauthorized() : Results.Ok(await ToSession(user, accounts, ct));
        }).RequireAuthorization().WithMetadata(new PasswordChangeAllowed());

        accounts.MapPut("/profile", async (UpdateProfileRequest request, HttpContext context, UserAccounts accounts, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 120)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["displayName"] = ["Adj meg egy legfeljebb 120 karakteres nevet."] });
            var user = await accounts.UpdateOwnName(context.User.FindFirst("sub")!.Value, request.DisplayName, ct);
            return Results.Ok(await ToSession(user, accounts, ct));
        }).RequireAuthorization();

        accounts.MapPost("/register", async (RegisterRequest request, HttpContext context, UserAccounts accounts,
            AccountRegistration registration, AccountRecovery recovery, IOptions<AccountOptions> options, CancellationToken ct) =>
        {
            var actor = context.User.FindFirst("sub")!.Value;
            ApplicationUser user;
            try
            {
                user = await accounts.SystemOperation(actor,
                    () => registration.Create(request, actor, options.Value.RequireEmailConfirmation, ct), ct);
            }
            catch (ManagementException error) when (error.Code is "invalid_user_name" or "duplicate_username")
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["userName"] = [error.Message] });
            }
            if (user.EmailConfirmationRequired) await recovery.Request(user.Email, true, ct);
            return Results.Created($"/api/v1/system/users/{user.Id}",
                new { user.Id, user.DisplayName, user.Email, requiresEmailConfirmation = user.EmailConfirmationRequired });
        }).RequireAuthorization(SystemPermissions.Manage).RequireRateLimiting("accounts");

        accounts.MapPost("/login", async (LoginRequest request, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, UserAccounts accounts, HermesDbContext db, CancellationToken ct) =>
        {
            if (string.IsNullOrEmpty(request.Password) || request.Password.Length > 128
                || (request.UserName is null ? !ValidEmail(request.Email) : !UserNames.IsValid(request.UserName)))
                return InvalidLogin();
            var user = request.UserName is { } name
                ? await users.FindByNameAsync(UserNames.Normalize(name)) : await users.FindByEmailAsync(request.Email!.Trim());
            if (user is null) return InvalidLogin();
            if (user.EmailConfirmationRequired && !user.EmailConfirmed) return InvalidLogin();
            if (await db.AccountLifecycles.AnyAsync(x => x.UserId == user.Id && x.IsArchived, ct)) return InvalidLogin();
            if (!app.Environment.IsDevelopment() && await db.AccountLifecycles.AnyAsync(x => x.UserId == user.Id && x.DevelopmentOnly, ct)) return InvalidLogin();
            var result = await signIn.PasswordSignInAsync(user, request.Password, isPersistent: false, lockoutOnFailure: true);
            return result.Succeeded ? Results.Ok(await ToSession(user, accounts, ct)) : InvalidLogin();
        }).AllowAnonymous().RequireRateLimiting("accounts");

        accounts.MapPost("/change-password", async (ChangePasswordRequest request, HttpContext context, UserAccounts accounts, CancellationToken ct) =>
        {
            var user = await accounts.ChangePassword(context.User.FindFirst("sub")!.Value, request, ct);
            return Results.Ok(await ToSession(user, accounts, ct));
        }).RequireAuthorization().RequireRateLimiting("accounts").WithMetadata(new PasswordChangeAllowed());

        accounts.MapPost("/logout", async (SignInManager<ApplicationUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.NoContent();
        }).RequireAuthorization().WithMetadata(new PasswordChangeAllowed());
    }

    private static bool ValidEmail(string? email)
        => !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 254 && new EmailAddressAttribute().IsValid(email.Trim());

    private static async Task<SessionResponse> ToSession(ApplicationUser user, UserAccounts accounts, CancellationToken ct)
        => new(user.Id, user.DisplayName, user.Email!, user.PasswordChangeRequired, await accounts.SystemPermissionsFor(user.Id, ct));
    private static IResult InvalidLogin() => Results.Problem(statusCode: 401, title: "HibĂˇs felhasznĂˇlĂłnĂ©v, e-mail-cĂ­m vagy jelszĂł. PrĂłbĂˇld Ăşjra kĂ©sĹ‘bb, ha tĂ¶bbszĂ¶r sikertelenĂĽl prĂłbĂˇlkoztĂˇl.");
}
