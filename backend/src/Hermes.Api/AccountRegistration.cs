using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hermes.Api;

public sealed class AccountRegistration(HermesDbContext db, UserManager<ApplicationUser> users, IServiceProvider services)
{
    internal static string EntraKey(Guid tenantId, Guid objectId) => $"{tenantId:D}:{objectId:D}";

    public async Task<ApplicationUser> Create(RegisterRequest request, string actor, bool requireConfirmation, CancellationToken ct)
    {
        UserAccounts.ValidateName(request.DisplayName);
        if (!UserAccounts.ValidEmail(request.Email)) throw UserAccounts.Error(400, "invalid_email", "Adj meg egy érvényes e-mail-címet.");
        if (!UserNames.IsValid(request.UserName))
            throw UserAccounts.Error(400, "invalid_user_name", "A felhasználónév 3–64 karakterből állhat. Használj angol betűt, számot, pontot, kötőjelet vagy aláhúzást, és kezdd betűvel vagy számmal.");

        var entra = services.GetService<EntraOptions>();
        var microsoftOnly = request.EntraObjectId is not null;
        if (microsoftOnly && (entra?.Enabled != true || request.EntraObjectId == Guid.Empty || request.Password is not null))
            throw UserAccounts.Error(400, "invalid_entra_account", "A Microsoft-fiókhoz működő Entra-beállítás és érvényes Object ID szükséges.");
        if (!microsoftOnly && (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length is < 12 or > 128))
            throw UserAccounts.Error(400, "invalid_password", "A jelszó 12–128 karakter hosszú legyen.");

        var userName = UserNames.Normalize(request.UserName);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({userName}, 157422991))", ct);
        if (await db.UserIdentityHistory.AnyAsync(x => x.ReservedName == userName, ct)
            || await db.Users.AnyAsync(x => x.Id == userName, ct))
            throw UserAccounts.Error(400, "duplicate_username", "Ez a felhasználónév már foglalt vagy fenntartott.");

        var user = new ApplicationUser
        {
            Id = userName,
            UserName = userName,
            Email = request.Email.Trim(),
            DisplayName = request.DisplayName.Trim(),
            EmailConfirmationRequired = !microsoftOnly && requireConfirmation,
        };
        try
        {
            var created = microsoftOnly ? await users.CreateAsync(user) : await users.CreateAsync(user, request.Password!);
            if (!created.Succeeded)
                throw UserAccounts.Error(400, "account_creation_failed", created.Errors.Any(error => error.Code == "DuplicateEmail")
                    ? "Ezzel az e-mail-címmel már létezik fiók." : "A fiók nem hozható létre a megadott adatokkal.");
            if (microsoftOnly && !(await users.AddLoginAsync(user, new UserLoginInfo(EntraSignIn.Scheme,
                EntraKey(entra!.TenantId, request.EntraObjectId!.Value), "Microsoft Entra ID"))).Succeeded)
                throw UserAccounts.Error(409, "entra_account_in_use", "Ez a Microsoft-fiók már hozzá van rendelve egy HERMES-fiókhoz.");
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } conflict)
        {
            throw conflict.ConstraintName == "PK_identity_user_logins"
                ? UserAccounts.Error(409, "entra_account_in_use", "Ez a Microsoft-fiók már hozzá van rendelve egy HERMES-fiókhoz.")
                : UserAccounts.Error(400, "duplicate_account", "A felhasználónév vagy az e-mail-cím már foglalt.");
        }
        db.UserIdentityHistory.Add(new() { PreviousId = user.Id, UserId = user.Id });
        UserAccounts.Audit(db, actor, user.Id, "user.registered", new { userName, microsoftOnly });
        await db.SaveChangesAsync(ct);
        return user;
    }

    public async Task InitializeAdmin(RegisterRequest request, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await UserAccounts.LockSystemAccess(db, ct);
        if (await db.SystemPermissionGrants.AnyAsync(x => x.Code == SystemPermissions.Manage, ct))
            throw new InvalidOperationException("A system manager already exists. Use the authenticated registration endpoint.");
        const string actor = "bootstrap:database-operator";
        var user = await Create(request, actor, false, ct);
        db.SystemPermissionGrants.Add(new() { UserId = user.Id, Code = SystemPermissions.Manage });
        UserAccounts.Audit(db, actor, user.Id, "user.system_access_bootstrapped", new { permission = SystemPermissions.Manage });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }
}
