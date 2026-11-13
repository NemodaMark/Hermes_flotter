using System.Text;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Hermes.Api;

public sealed class AccountOptions
{
    public bool RequireEmailConfirmation { get; set; }
}

public sealed class EmailConfirmationTokenOptions : DataProtectionTokenProviderOptions
{
    public EmailConfirmationTokenOptions() { Name = "Hermes.EmailConfirmation"; TokenLifespan = TimeSpan.FromHours(24); }
}

public sealed class EmailConfirmationTokenProvider(
    IDataProtectionProvider protection, IOptions<EmailConfirmationTokenOptions> options,
    ILogger<DataProtectorTokenProvider<ApplicationUser>> logger)
    : DataProtectorTokenProvider<ApplicationUser>(protection, options, logger);

public sealed record AccountEmailRequest(string Email);
public sealed record AccountTokenRequest(string UserId, string Email, string Token);
public sealed record ResetPasswordRequest(string UserId, string Email, string Token, string NewPassword, string ConfirmPassword);

public sealed class AccountRecovery(
    HermesDbContext db, UserManager<ApplicationUser> users, UserAccounts accounts,
    EmailDelivery delivery, IHostEnvironment environment)
{
    public const string GenericMessage = "Ha az e-mail-címhez használható fiók tartozik, elküldtük a hivatkozást. Nézd meg a levélszemét mappát is; új levelet egy perc múlva kérhetsz.";

    private async Task<bool> Usable(string id, CancellationToken ct) => !await db.AccountLifecycles.AnyAsync(
        x => x.UserId == id && (x.IsArchived || !environment.IsDevelopment() && x.DevelopmentOnly), ct);

    public async Task Request(string? email, bool confirmation, CancellationToken ct)
    {
        if (!delivery.Enabled) throw UserAccounts.Error(503, "email_unavailable", "A levélküldés még nincs beállítva. Kérd a rendszergazda segítségét.");
        if (!UserAccounts.ValidEmail(email)) return;
        var user = await users.FindByEmailAsync(email!.Trim());
        if (user is null || !await Usable(user.Id, ct)) return;
        string link;
        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            user = await accounts.LockUser(user.Id, ct);
            if (!await Usable(user.Id, ct) || confirmation && user.EmailConfirmed
                || user.AccountEmailSentAt > DateTimeOffset.UtcNow.AddMinutes(-1)) return;
            var token = confirmation ? await users.GenerateEmailConfirmationTokenAsync(user) : await users.GeneratePasswordResetTokenAsync(user);
            var query = new Dictionary<string, string?>
            {
                ["userId"] = user.Id, ["email"] = user.Email,
                ["token"] = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token))
            };
            link = delivery.Link(QueryHelpers.AddQueryString(confirmation ? "/account/confirm" : "/account/reset", query));
            user.AccountEmailSentAt = DateTimeOffset.UtcNow;
            UserAccounts.Audit(db, "anonymous:account-recovery", user.Id, confirmation ? "user.email_confirmation_requested" : "user.password_reset_requested", new { });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        // Network I/O happens after releasing the account row lock. Failures never expose tokens.
        await delivery.TrySend(new(user.Email!, confirmation ? "HERMES – E-mail-cím megerősítése" : "HERMES – Jelszó-visszaállítás",
            $"{(confirmation ? "Erősítsd meg az e-mail-címedet az alábbi hivatkozással (24 órán belül):" : "Új jelszót az alábbi hivatkozással állíthatsz be (1 órán belül):")}\n\n{link}\n\nHa nem te kérted, hagyd figyelmen kívül ezt a levelet."), ct);
    }

    private static Exception InvalidToken() => UserAccounts.Error(400, "invalid_account_token", "A hivatkozás érvénytelen, lejárt vagy már felhasználtad. Kérj új levelet.");
    private static string Decode(string? token)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096) throw InvalidToken();
        try { return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token)); }
        catch (FormatException) { throw InvalidToken(); }
    }

    private async Task<ApplicationUser> TokenUser(string? id, string? email, CancellationToken ct)
    {
        if (id is null || id.Length > 64 || !UserAccounts.ValidEmail(email)) throw InvalidToken();
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id, ct);
        if (user is null || !await Usable(user.Id, ct)) throw InvalidToken();
        user = await accounts.LockUser(user.Id, ct);
        if (user.NormalizedEmail != users.NormalizeEmail(email!.Trim()) || !await Usable(user.Id, ct)) throw InvalidToken();
        return user;
    }

    public async Task Confirm(AccountTokenRequest request, CancellationToken ct)
    {
        var token = Decode(request.Token);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = await TokenUser(request.UserId, request.Email, ct);
        if (user.EmailConfirmed || !(await users.ConfirmEmailAsync(user, token)).Succeeded) throw InvalidToken();
        user.ProfileVersion++;
        UserAccounts.Audit(db, user.Id, user.Id, "user.email_confirmed", new { version = user.ProfileVersion });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    public async Task Reset(ResetPasswordRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length is < 12 or > 128)
            throw UserAccounts.Error(400, "invalid_password", "Az új jelszó 12–128 karakter hosszú legyen.");
        if (request.NewPassword != request.ConfirmPassword)
            throw UserAccounts.Error(400, "password_mismatch", "A két új jelszó nem egyezik.");
        var token = Decode(request.Token);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = await TokenUser(request.UserId, request.Email, ct);
        // Identity changes the security stamp: this token and every existing login cookie expire.
        if (!(await users.ResetPasswordAsync(user, token, request.NewPassword)).Succeeded) throw InvalidToken();
        user.PasswordChangeRequired = false;
        user.PasswordChangedAt = DateTimeOffset.UtcNow;
        user.ProfileVersion++;
        user.AccessFailedCount = 0;
        user.LockoutEnd = null;
        UserAccounts.Audit(db, user.Id, user.Id, "user.password_reset", new { version = user.ProfileVersion });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }
}

public static class AccountRecoveryEndpoints
{
    public static void MapAccountRecovery(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1/auth").AllowAnonymous().RequireRateLimiting("accounts").WithMetadata(new PasswordChangeAllowed());
        group.MapGet("/options", (EmailDelivery mail, IOptions<AccountOptions> options, EntraOptions entra, HttpContext context) => Results.Ok(new
        { emailEnabled = mail.Enabled, requireEmailConfirmation = options.Value.RequireEmailConfirmation, entraEnabled = entra.Enabled && context.Request.IsHttps }));
        group.MapPost("/forgot-password", async (AccountEmailRequest request, AccountRecovery recovery, CancellationToken ct) =>
        {
            await recovery.Request(request.Email, false, ct);
            return Results.Accepted(value: new { message = AccountRecovery.GenericMessage });
        });
        group.MapPost("/resend-confirmation", async (AccountEmailRequest request, AccountRecovery recovery, CancellationToken ct) =>
        {
            await recovery.Request(request.Email, true, ct);
            return Results.Accepted(value: new { message = AccountRecovery.GenericMessage });
        });
        group.MapPost("/confirm-email", async (AccountTokenRequest request, AccountRecovery recovery, CancellationToken ct) =>
        {
            await recovery.Confirm(request, ct);
            return Results.Ok(new { message = "Az e-mail-címedet megerősítettük. Most már bejelentkezhetsz." });
        });
        group.MapPost("/reset-password", async (ResetPasswordRequest request, AccountRecovery recovery, CancellationToken ct) =>
        {
            await recovery.Reset(request, ct);
            return Results.Ok(new { message = "Az új jelszót elmentettük. Jelentkezz be vele újra." });
        });
    }
}
