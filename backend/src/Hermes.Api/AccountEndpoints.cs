using System.ComponentModel.DataAnnotations;
using Hermes.Application;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hermes.Api;

public sealed record RegisterRequest(string DisplayName, string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
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

        accounts.MapPost("/register", async (RegisterRequest request, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, UserAccounts accounts, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 120)
                errors["displayName"] = ["Adj meg egy legfeljebb 120 karakteres nevet."];
            if (!ValidEmail(request.Email)) errors["email"] = ["Adj meg egy érvényes e-mail-címet."];
            if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length is < 12 or > 128)
                errors["password"] = ["A jelszó 12–128 karakter hosszú legyen."];
            if (errors.Count != 0) return Results.ValidationProblem(errors);

            var user = new ApplicationUser
            {
                Id = Guid.CreateVersion7().ToString(),
                UserName = request.Email.Trim(),
                Email = request.Email.Trim(),
                DisplayName = request.DisplayName.Trim()
            };
            IdentityResult result;
            try { result = await users.CreateAsync(user, request.Password!); }
            catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                return DuplicateEmail();
            }
            if (!result.Succeeded)
            {
                if (result.Errors.Any(error => error.Code is "DuplicateEmail" or "DuplicateUserName")) return DuplicateEmail();
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["account"] = ["A fiók nem hozható létre a megadott adatokkal."] });
            }
            await signIn.SignInAsync(user, isPersistent: false);
            return Results.Created("/api/v1/auth/session", await ToSession(user, accounts, ct));
        }).AllowAnonymous().RequireRateLimiting("accounts");

        accounts.MapPost("/login", async (LoginRequest request, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, UserAccounts accounts, CancellationToken ct) =>
        {
            if (!ValidEmail(request.Email) || string.IsNullOrEmpty(request.Password) || request.Password.Length > 128)
                return InvalidLogin();
            var user = await users.FindByEmailAsync(request.Email.Trim());
            if (user is null) return InvalidLogin();
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
        => new(user.Id, user.DisplayName, user.Email!, user.PasswordChangeRequired, (await accounts.Profile(user, ct)).SystemPermissions);
    private static IResult InvalidLogin() => Results.Problem(statusCode: 401, title: "Hibás e-mail-cím vagy jelszó. Próbáld újra később, ha többször sikertelenül próbálkoztál.");
    private static IResult DuplicateEmail() => Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = ["Ezzel az e-mail-címmel már létezik fiók."] });
}
