using System.ComponentModel.DataAnnotations;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hermes.Api;

public sealed record RegisterRequest(string DisplayName, string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record SessionResponse(string Id, string DisplayName, string Email);
public sealed record UpdateProfileRequest(string DisplayName);

public static class AccountEndpoints
{
    public static void MapAccountEndpoints(this WebApplication app)
    {
        var accounts = app.MapGroup("/api/v1/auth");
        accounts.MapGet("/csrf", (HttpContext context, IAntiforgery antiforgery) =>
            Results.Ok(new { requestToken = antiforgery.GetAndStoreTokens(context).RequestToken })).AllowAnonymous();

        accounts.MapGet("/session", async (HttpContext context, UserManager<ApplicationUser> users) =>
        {
            var user = await users.GetUserAsync(context.User);
            return user is null ? Results.Unauthorized() : Results.Ok(ToSession(user));
        }).RequireAuthorization();

        accounts.MapPut("/profile", async (UpdateProfileRequest request, HttpContext context, UserManager<ApplicationUser> users) =>
        {
            if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 120)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["displayName"] = ["Adj meg egy legfeljebb 120 karakteres nevet."] });
            var user = await users.GetUserAsync(context.User);
            if (user is null) return Results.Unauthorized();
            user.DisplayName = request.DisplayName.Trim();
            var result = await users.UpdateAsync(user);
            return result.Succeeded ? Results.Ok(ToSession(user)) : Results.Problem(statusCode: 409, title: "A profil időközben megváltozott. Próbáld újra.");
        }).RequireAuthorization();

        accounts.MapPost("/register", async (RegisterRequest request, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn) =>
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
            return Results.Created("/api/v1/auth/session", ToSession(user));
        }).AllowAnonymous().RequireRateLimiting("accounts");

        accounts.MapPost("/login", async (LoginRequest request, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn) =>
        {
            if (!ValidEmail(request.Email) || string.IsNullOrEmpty(request.Password) || request.Password.Length > 128)
                return InvalidLogin();
            var user = await users.FindByEmailAsync(request.Email.Trim());
            if (user is null) return InvalidLogin();
            var result = await signIn.PasswordSignInAsync(user, request.Password, isPersistent: false, lockoutOnFailure: true);
            return result.Succeeded ? Results.Ok(ToSession(user)) : InvalidLogin();
        }).AllowAnonymous().RequireRateLimiting("accounts");

        accounts.MapPost("/logout", async (SignInManager<ApplicationUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static bool ValidEmail(string? email)
        => !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 254 && new EmailAddressAttribute().IsValid(email.Trim());

    private static SessionResponse ToSession(ApplicationUser user) => new(user.Id, user.DisplayName, user.Email!);
    private static IResult InvalidLogin() => Results.Problem(statusCode: 401, title: "Hibás e-mail-cím vagy jelszó. Próbáld újra később, ha többször sikertelenül próbálkoztál.");
    private static IResult DuplicateEmail() => Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = ["Ezzel az e-mail-címmel már létezik fiók."] });
}
