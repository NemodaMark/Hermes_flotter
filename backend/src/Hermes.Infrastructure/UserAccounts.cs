using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hermes.Infrastructure;

public sealed class UserAccounts(HermesDbContext db, UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn)
{
    public static ManagementException Error(int status, string code, string message) => new(status, code, message);
    public static Task<bool> IsSystemManager(HermesDbContext db, string subject, CancellationToken ct)
        => db.SystemPermissionGrants.AnyAsync(x => x.UserId == subject && x.Code == SystemPermissions.Manage, ct);

    // Also used by bootstrap and tenant mutations: revocation cannot race a privileged write.
    public static Task LockSystemAccess(HermesDbContext db, CancellationToken ct, bool shared = false)
        => db.Database.ExecuteSqlRawAsync(shared
            ? "SELECT pg_advisory_xact_lock_shared(724385916)"
            : "SELECT pg_advisory_xact_lock(724385916)", ct);

    public async Task<ApplicationUser> LockUser(string id, CancellationToken ct)
    {
        var user = await db.Users.FromSqlInterpolated($"SELECT * FROM identity_users WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(ct)
            ?? throw Error(404, "user_not_found", "A felhasználó nem található.");
        // Cookie validation may already have tracked this user before the row lock was acquired.
        await db.Entry(user).ReloadAsync(ct);
        return user;
    }
    public static void Audit(HermesDbContext db, string actor, string? target, string action, object details, Guid? tenantId = null)
        => db.SystemAuditEvents.Add(new() { ActorSubject = actor, TargetSubject = target, Action = action,
            Details = JsonSerializer.Serialize(details), TenantId = tenantId });

    public async Task<UserProfile> Profile(ApplicationUser user, CancellationToken ct)
        => new(user.Id, user.DisplayName, user.Email!, user.PhoneNumber, user.ProfileVersion, user.PasswordChangeRequired,
            user.PasswordChangeRequestedAt, user.PasswordChangedAt,
            await db.SystemPermissionGrants.Where(x => x.UserId == user.Id).OrderBy(x => x.Code).Select(x => x.Code).ToArrayAsync(ct));

    public async Task<T> SystemOperation<T>(string actor, Func<Task<T>> action, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockSystemAccess(db, ct);
        if (!await IsSystemManager(db, actor, ct)) throw Error(403, "system_permission_required", "Rendszerszintű kezelési jogosultság szükséges.");
        var result = await action();
        await transaction.CommitAsync(ct);
        return result;
    }
    public static void CheckVersion(ApplicationUser user, long version)
    {
        if (version < 1) throw Error(400, "invalid_version", "A profil aktuális verziója szükséges.");
        if (user.ProfileVersion != version) throw Error(409, "stale_profile", "A profil időközben megváltozott. Töltsd be újra az adatait.");
    }
    public static void ValidateName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 120)
            throw Error(400, "invalid_name", "Adj meg egy legfeljebb 120 karakteres nevet.");
    }
    public static bool ValidEmail(string? email)
        => !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 254 && new EmailAddressAttribute().IsValid(email.Trim());

    public Task<UserProfile> Edit(string actor, string id, EditUserProfileRequest request, CancellationToken ct)
        => SystemOperation(actor, async () =>
        {
            ValidateName(request.DisplayName);
            if (!ValidEmail(request.Email)) throw Error(400, "invalid_email", "Adj meg egy érvényes e-mail-címet.");
            if (request.PhoneNumber?.Trim().Length > 40) throw Error(400, "invalid_phone", "A telefonszám legfeljebb 40 karakter lehet.");
            var user = await LockUser(id, ct);
            CheckVersion(user, request.Version);
            var before = new { user.DisplayName, user.Email, user.PhoneNumber };
            var emailChanged = user.Email != request.Email.Trim();
            user.DisplayName = request.DisplayName.Trim();
            user.Email = request.Email.Trim();
            if (emailChanged) user.EmailConfirmed = false;
            var phone = string.IsNullOrWhiteSpace(request.PhoneNumber) ? null : request.PhoneNumber.Trim();
            if (phone != user.PhoneNumber) user.PhoneNumberConfirmed = false;
            user.PhoneNumber = phone;
            user.ProfileVersion++;
            // A changed login invalidates every previously issued cookie, including the caller's own cookie.
            if (emailChanged) user.SecurityStamp = Guid.NewGuid().ToString();
            IdentityResult result;
            try { result = await users.UpdateAsync(user); }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { throw Error(409, "duplicate_email", "Ezzel az e-mail-címmel már létezik fiók."); }
            if (!result.Succeeded) throw Error(409, "profile_conflict", "A profil nem menthető. Az e-mail-cím már foglalt, vagy az adatok megváltoztak.");
            Audit(db, actor, id, "user.profile_changed", new { before, after = new { user.DisplayName, user.Email, user.PhoneNumber }, version = user.ProfileVersion });
            await db.SaveChangesAsync(ct);
            return await Profile(user, ct);
        }, ct);

    public Task<UserProfile> ForcePasswordChange(string actor, string id, long version, CancellationToken ct)
        => SystemOperation(actor, async () =>
        {
            var user = await LockUser(id, ct);
            CheckVersion(user, version);
            user.PasswordChangeRequired = true;
            user.PasswordChangeRequestedAt = DateTimeOffset.UtcNow;
            user.ProfileVersion++;
            var result = await users.UpdateSecurityStampAsync(user);
            if (!result.Succeeded) throw Error(409, "profile_conflict", "A profil időközben megváltozott.");
            Audit(db, actor, id, "user.password_change_required", new { version = user.ProfileVersion });
            await db.SaveChangesAsync(ct);
            return await Profile(user, ct);
        }, ct);

    public Task<UserProfile> ChangeSystemAccess(string actor, string id, ChangeSystemAccessRequest request, CancellationToken ct)
        => SystemOperation(actor, async () =>
        {
            if (request.Enabled is null) throw Error(400, "missing_status", "Az enabled értékét kifejezetten add meg.");
            var enabled = request.Enabled.Value;
            var user = await LockUser(id, ct);
            CheckVersion(user, request.Version);
            var grant = await db.SystemPermissionGrants.SingleOrDefaultAsync(x => x.UserId == id && x.Code == SystemPermissions.Manage, ct);
            if (!enabled && grant is not null && !await db.SystemPermissionGrants.AnyAsync(x => x.Code == SystemPermissions.Manage && x.UserId != id, ct))
                throw Error(409, "last_system_manager", "Az utolsó rendszerszintű kezelő jogosultsága nem vonható vissza.");
            if (enabled && grant is null) db.SystemPermissionGrants.Add(new() { UserId = id, Code = SystemPermissions.Manage });
            if (!enabled && grant is not null) db.SystemPermissionGrants.Remove(grant);
            user.ProfileVersion++;
            Audit(db, actor, id, "user.system_access_changed", new { before = grant is not null, after = request.Enabled, permission = SystemPermissions.Manage, version = user.ProfileVersion });
            await db.SaveChangesAsync(ct);
            return await Profile(user, ct);
        }, ct);

    public async Task<ApplicationUser> UpdateOwnName(string id, string name, CancellationToken ct)
    {
        ValidateName(name);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUser(id, ct);
        var before = user.DisplayName;
        user.DisplayName = name.Trim();
        user.ProfileVersion++;
        if (!(await users.UpdateAsync(user)).Succeeded) throw Error(409, "profile_conflict", "A profil időközben megváltozott.");
        Audit(db, id, id, "user.name_changed", new { before, after = user.DisplayName, version = user.ProfileVersion });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return user;
    }

    public async Task<ApplicationUser> ChangePassword(string id, ChangePasswordRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length is < 12 or > 128)
            throw Error(400, "invalid_password", "Az új jelszó 12–128 karakter hosszú legyen.");
        if (request.NewPassword != request.ConfirmPassword) throw Error(400, "password_mismatch", "A két új jelszó nem egyezik.");
        if (string.IsNullOrEmpty(request.CurrentPassword) || request.CurrentPassword.Length > 128)
            throw Error(400, "invalid_current_password", "Add meg a jelenlegi jelszavadat.");
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var user = await LockUser(id, ct);
        var check = await signIn.CheckPasswordSignInAsync(user, request.CurrentPassword, lockoutOnFailure: true);
        if (!check.Succeeded)
        {
            // Persist Identity's failure counter/lockout instead of rolling it back on a validation error.
            await transaction.CommitAsync(ct);
            throw Error(400, "invalid_current_password", "A jelenlegi jelszó hibás, vagy a fiók ideiglenesen zárolt.");
        }
        if (await users.CheckPasswordAsync(user, request.NewPassword))
            throw Error(400, "password_reused", "Az új jelszó térjen el a jelenlegitől.");
        var result = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded) throw Error(409, "password_conflict", "A jelszó nem módosítható. Próbáld újra.");
        user.PasswordChangeRequired = false;
        user.PasswordChangedAt = DateTimeOffset.UtcNow;
        user.ProfileVersion++;
        Audit(db, id, id, "user.password_changed", new { version = user.ProfileVersion });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        await signIn.RefreshSignInAsync(user);
        return user;
    }

    public static async Task Bootstrap(HermesDbContext db, string id, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockSystemAccess(db, ct);
        if (await db.SystemPermissionGrants.AnyAsync(x => x.Code == SystemPermissions.Manage, ct))
            throw new InvalidOperationException("A system manager already exists. Delegate access through the authenticated API.");
        var user = await db.Users.SingleOrDefaultAsync(x => x.Id == id, ct)
            ?? throw new InvalidOperationException("Specify an existing user ID.");
        db.SystemPermissionGrants.Add(new() { UserId = id, Code = SystemPermissions.Manage });
        user.ProfileVersion++;
        Audit(db, "bootstrap:database-operator", id, "user.system_access_bootstrapped", new { permission = SystemPermissions.Manage });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }
}
