using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class MemberManagement(HermesDbContext db, TenantContext context, ILookupNormalizer normalizer) : IMemberManagement
{
    private Guid TenantId => context.TenantId ?? throw new InvalidOperationException("Tenant context is required.");
    private string Actor => context.UserSubject ?? throw new InvalidOperationException("An authenticated actor is required.");
    private static ManagementException Error(int status, string code, string message) => new(status, code, message);
    private static ManagementException Forbidden() => Error(403, "permission_denied", "Ehhez a művelethez nincs jogosultságod.");
    private static string[] Codes(TenantMembership member) => member.EffectivePermissions;
    private static string[] Direct(TenantMembership member) => member.Permissions.Select(x => x.Code).Order(StringComparer.Ordinal).ToArray();
    private static TenantAccess Access(TenantMembership member) => AccessRules.Access(member);

    private Task<T> Scoped<T>(Func<Task<T>> action, CancellationToken ct) => TenantTransaction.RunAsync(db, TenantId, action, ct);
    private async Task LockTenant(CancellationToken ct)
    {
        // One database row lock per company serializes grants, suspension and invitation acceptance across API instances.
        if (await db.Tenants.FromSqlInterpolated($"SELECT * FROM tenants WHERE \"Id\" = {TenantId} FOR UPDATE").AsNoTracking().SingleOrDefaultAsync(ct) is null)
            throw Error(404, "tenant_not_found", "A cég nem található.");
    }
    private async Task<TenantMembership> ActorWith(string permission, CancellationToken ct)
    {
        return await AccessRules.Authorize(db, TenantId, Actor, permission, ct);
    }
    private Task<T> Authorized<T>(string permission, Func<TenantMembership, Task<T>> action, CancellationToken ct) => Scoped(async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await LockTenant(ct);
        var actor = await ActorWith(permission, ct);
        return await action(actor);
    }, ct);
    private async Task<TenantMembership> Member(string userId, CancellationToken ct)
        => await db.Memberships.WithAccess().SingleOrDefaultAsync(item => item.TenantId == TenantId && item.UserSubject == userId, ct)
            ?? throw Error(404, "member_not_found", "A céges felhasználó nem található.");
    private void Audit(string action, string? target, object details)
    {
        db.AccessAuditEvents.Add(new() { TenantId = TenantId, ActorSubject = Actor, Action = action, TargetSubject = target, Details = JsonSerializer.Serialize(details) });
        UserAccounts.Audit(db, Actor, target, action, details, TenantId);
    }
    private static void CheckVersion(TenantMembership target, long version)
    {
        if (version < 1) throw Error(400, "invalid_version", "A tagság aktuális verzióját add meg.");
        if (target.Version != version) throw Error(409, "stale_membership", "A tagság időközben megváltozott. Kérd le újra az adatait.");
    }
    private static string[] ValidatePermissions(string[]? permissions)
    {
        if (permissions is null || permissions.Length > Permissions.Catalog.Count || permissions.Any(code => code is null || !Permissions.All.Contains(code, StringComparer.Ordinal))
            || permissions.Distinct(StringComparer.Ordinal).Count() != permissions.Length)
            throw Error(400, "invalid_permissions", "Csak a katalógusban szereplő, ismétlés nélküli jogosultságok adhatók meg.");
        return permissions.Order(StringComparer.Ordinal).ToArray();
    }
    private static void MayDelegate(TenantMembership actor, IEnumerable<string> affected)
    {
        var own = Codes(actor).ToHashSet(StringComparer.Ordinal);
        if (affected.Any(code => !own.Contains(code))) throw Error(403, "delegation_denied", "Csak a saját jogosultságaid körén belül adhatsz vagy vonhatsz vissza hozzáférést.");
    }
    private async Task ProtectLastManager(TenantMembership member, bool active, string[] permissions, CancellationToken ct)
    {
        if (!member.IsActive || !Codes(member).Contains(Permissions.Manage) || (active && permissions.Contains(Permissions.Manage))) return;
        var others = await db.Memberships.AsNoTracking().WithAccess().Where(other => other.TenantId == TenantId && other.UserSubject != member.UserSubject && other.IsActive).ToListAsync(ct);
        if (!others.Any(other => Codes(other).Contains(Permissions.Manage))) throw AccessRules.LastManager();
    }
    private static int Offset(int page, int pageSize)
    {
        if (page is < 1 or > 10000 || pageSize is < 1 or > 100) throw Error(400, "invalid_page", "A page 1–10000, a pageSize 1–100 közötti legyen.");
        return (page - 1) * pageSize;
    }
    private async Task<MemberSummary> Summary(TenantMembership member, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().Where(user => user.Id == member.UserSubject).Select(user => new { user.DisplayName, user.Email }).SingleOrDefaultAsync(ct);
        return new(member.UserSubject, user?.DisplayName, user?.Email, member.IsActive, member.Version, Codes(member), member.JoinedAt, member.DisabledAt) { DirectPermissions = Direct(member), Groups = AccessRules.Groups(member) };
    }

    public Task<PageResult<MemberSummary>> ListAsync(int page, int pageSize, string? search, CancellationToken ct) => Scoped<PageResult<MemberSummary>>(async () =>
    {
        var offset = Offset(page, pageSize);
        if (search?.Length > 100) throw Error(400, "invalid_search", "A keresés legfeljebb 100 karakter lehet.");
        var query = db.Memberships.AsNoTracking().Where(item => item.TenantId == TenantId && (item.HasDirectAccess || item.CompanyGroups.Any()));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToUpperInvariant();
            query = query.Where(item => db.Users.Any(user => user.Id == item.UserSubject
                && (user.NormalizedEmail!.Contains(value) || user.DisplayName.ToUpper().Contains(value) || user.NormalizedUserName!.Contains(value))));
        }
        var total = await query.CountAsync(ct);
        var members = await query.WithAccess().OrderBy(item => item.UserSubject).Skip(offset).Take(pageSize).ToListAsync(ct);
        var userIds = members.Select(member => member.UserSubject).ToArray();
        var users = await db.Users.AsNoTracking().Where(user => userIds.Contains(user.Id))
            .Select(user => new { user.Id, user.DisplayName, user.Email }).ToDictionaryAsync(user => user.Id, ct);
        var result = members.Select(member =>
        {
            users.TryGetValue(member.UserSubject, out var user);
            return new MemberSummary(member.UserSubject, user?.DisplayName, user?.Email, member.IsActive,
                member.Version, Codes(member), member.JoinedAt, member.DisabledAt) { DirectPermissions = Direct(member), Groups = AccessRules.Groups(member) };
        }).ToArray();
        return new(result, total, page, pageSize);
    }, ct);
    public Task<MemberSummary> GetAsync(string userId, CancellationToken ct) => Scoped(async () => await Summary(await Member(userId, ct), ct), ct);
    public Task<TenantAccess> GetAccessAsync(string userId, CancellationToken ct) => Scoped(async () =>
    {
        var member = await db.Memberships.WithAccess().SingleOrDefaultAsync(x => x.TenantId == TenantId && x.UserSubject == userId, ct);
        if (userId == Actor && await UserAccounts.IsSystemManager(db, Actor, ct))
            return Access(member ?? TenantDirectory.SystemMembership(Actor, TenantId)) with { Permissions = Permissions.All };
        return Access(member ?? throw Error(404, "member_not_found", "A céges felhasználó nem található."));
    }, ct);

    public Task<TenantAccess> ChangePermissionsAsync(string userId, ChangePermissionsRequest request, CancellationToken ct) => Authorized(Permissions.Manage, async actor =>
    {
        var desired = ValidatePermissions(request.Permissions);
        var target = await Member(userId, ct);
        CheckVersion(target, request.Version);
        var before = Direct(target);
        MayDelegate(actor, before.Except(desired).Concat(desired.Except(before)));
        await ProtectLastManager(target, target.IsActive, desired.Concat(target.Groups.SelectMany(x => x.Group.EffectivePermissions))
            .Concat(target.CompanyGroups.SelectMany(x => x.Group.EffectivePermissions)).Distinct().ToArray(), ct);
        foreach (var removed in target.Permissions.Where(item => !desired.Contains(item.Code)).ToArray())
        { target.Permissions.Remove(removed); db.MembershipPermissions.Remove(removed); }
        foreach (var added in desired.Except(before)) target.Permissions.Add(new() { TenantId = TenantId, UserSubject = userId, Code = added });
        if (desired.Length > 0) target.HasDirectAccess = true;
        target.Version++;
        Audit("member.permissions_changed", userId, new { before, after = desired, version = target.Version });
        await db.SaveChangesAsync(ct);
        return Access(target);
    }, ct);

    public Task<TenantAccess> ChangeStatusAsync(string userId, ChangeMemberStatusRequest request, CancellationToken ct) => Authorized(Permissions.MembersUpdate, async actor =>
    {
        if (request.IsActive is null) throw Error(400, "missing_status", "Az isActive értékét kifejezetten add meg.");
        var active = request.IsActive.Value;
        var target = await Member(userId, ct);
        CheckVersion(target, request.Version);
        if (!target.IsActive && active) MayDelegate(actor, Codes(target));
        if (!target.IsActive && active && target.HasAdminAuthority && !actor.HasAdminAuthority
            && !await UserAccounts.IsSystemManager(db, Actor, ct))
            throw Error(403, "admin_delegation_denied", "Az admin hozzáférést céges admin vagy rendszergazda állíthatja vissza.");
        await ProtectLastManager(target, active, Codes(target), ct);
        var before = target.IsActive;
        target.IsActive = active;
        target.DisabledAt = active ? null : DateTimeOffset.UtcNow;
        target.Version++;
        Audit("member.status_changed", userId, new { before, after = request.IsActive, version = target.Version });
        await db.SaveChangesAsync(ct);
        return Access(target);
    }, ct);

    private static InvitationSummary Invitation(TenantInvitation item) => new(item.Id, item.Email,
        item.Permissions.Select(permission => permission.Code).Order(StringComparer.Ordinal).ToArray(), item.CreatedAt, item.ExpiresAt, item.AcceptedAt, item.RevokedAt);
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public Task<CreatedInvitation> InviteAsync(CreateInvitationRequest request, CancellationToken ct) => Authorized<CreatedInvitation>(Permissions.MembersInvite, async actor =>
    {
        if (string.IsNullOrWhiteSpace(request.Email) || request.Email.Trim().Length > 254 || !new EmailAddressAttribute().IsValid(request.Email.Trim()))
            throw Error(400, "invalid_email", "Adj meg egy érvényes e-mail-címet.");
        var grants = ValidatePermissions(request.Permissions);
        if (grants.Length > 0 && !Codes(actor).Contains(Permissions.Manage)) throw Forbidden();
        MayDelegate(actor, grants);
        var email = request.Email.Trim();
        var normalized = normalizer.NormalizeEmail(email)!;
        if (await db.Memberships.AnyAsync(member => member.TenantId == TenantId && (member.HasDirectAccess || member.CompanyGroups.Any() || !member.IsActive)
            && db.Users.Any(user => user.Id == member.UserSubject && user.NormalizedEmail == normalized), ct))
            throw Error(409, "already_member", "Ez a felhasználó már a cég tagja. A meglévő tagságát kezeld.");
        var pending = await db.Invitations.Where(item => item.NormalizedEmail == normalized && item.AcceptedAt == null && item.RevokedAt == null).ToListAsync(ct);
        if (pending.Any(item => item.ExpiresAt > DateTimeOffset.UtcNow)) throw Error(409, "pending_invitation", "Ehhez az e-mail-címhez már van érvényes meghívás.");
        foreach (var expired in pending) expired.RevokedAt = DateTimeOffset.UtcNow;
        if (pending.Count > 0) await db.SaveChangesAsync(ct);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var invitation = new TenantInvitation
        {
            TenantId = TenantId, Email = email, NormalizedEmail = normalized, InvitedBy = Actor,
            TokenHash = Hash(token), ExpiresAt = DateTimeOffset.UtcNow.AddDays(7)
        };
        invitation.Permissions = grants.Select(code => new InvitationPermission { TenantId = TenantId, InvitationId = invitation.Id, Code = code }).ToList();
        db.Invitations.Add(invitation);
        Audit("invitation.created", null, new { invitationId = invitation.Id, permissions = grants });
        await db.SaveChangesAsync(ct);
        return new(Invitation(invitation), new(TenantId, invitation.Id, token));
    }, ct);
    public Task<PageResult<InvitationSummary>> InvitationsAsync(int page, int pageSize, CancellationToken ct) => Scoped<PageResult<InvitationSummary>>(async () =>
    {
        var offset = Offset(page, pageSize);
        var query = db.Invitations.AsNoTracking();
        var total = await query.CountAsync(ct);
        var items = await query.Include(item => item.Permissions).OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id).Skip(offset).Take(pageSize).ToListAsync(ct);
        return new(items.Select(Invitation).ToArray(), total, page, pageSize);
    }, ct);
    public async Task RevokeAsync(Guid id, CancellationToken ct) => _ = await Authorized(Permissions.MembersInvite, async _ =>
    {
        var invitation = await db.Invitations.SingleOrDefaultAsync(item => item.Id == id, ct)
            ?? throw Error(404, "invitation_not_found", "A meghívó nem található.");
        if (invitation.AcceptedAt is not null) throw Error(409, "invitation_used", "A meghívót már elfogadták. A tagságot kezeld.");
        if (invitation.RevokedAt is null)
        {
            invitation.RevokedAt = DateTimeOffset.UtcNow;
            Audit("invitation.revoked", null, new { invitationId = id });
            await db.SaveChangesAsync(ct);
        }
        return true;
    }, ct);

    public async Task<TenantAccess> AcceptAsync(string userId, string normalizedEmail, AcceptInvitationRequest request, CancellationToken ct)
    {
        if (request.TenantId == Guid.Empty || request.InvitationId == Guid.Empty || string.IsNullOrWhiteSpace(request.Token) || request.Token.Length > 100)
            throw Error(400, "invalid_invitation", "Hiányos meghívási adatok.");
        context.Set(request.TenantId, userId, []);
        return await Scoped(async () =>
        {
            await UserAccounts.LockSystemAccess(db, ct, shared: true);
            await LockTenant(ct);
            var invitation = await db.Invitations.Include(item => item.Permissions).SingleOrDefaultAsync(item => item.Id == request.InvitationId, ct);
            if (invitation is null || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(invitation.TokenHash), Encoding.ASCII.GetBytes(Hash(request.Token))))
                throw Error(404, "invalid_invitation", "A meghívó nem érvényes.");
            if (invitation.NormalizedEmail != normalizedEmail) throw Error(403, "invitation_email_mismatch", "A meghívó másik e-mail-címhez tartozik.");
            if (invitation.AcceptedAt is not null || invitation.RevokedAt is not null || invitation.ExpiresAt <= DateTimeOffset.UtcNow)
                throw Error(409, "invitation_unavailable", "A meghívót már felhasználták, visszavonták vagy lejárt.");
            var issuer = await db.Memberships.AsNoTracking().WithAccess().SingleOrDefaultAsync(item => item.TenantId == TenantId && item.UserSubject == invitation.InvitedBy && item.IsActive, ct);
            var grants = invitation.Permissions.Select(item => item.Code).ToArray();
            if (!await UserAccounts.IsSystemManager(db, invitation.InvitedBy, ct)
                && (issuer is null || !Codes(issuer).Contains(Permissions.MembersInvite) || (grants.Length > 0 && !Codes(issuer).Contains(Permissions.Manage)) || grants.Except(Codes(issuer)).Any()))
                throw Error(409, "inviter_access_changed", "A meghívó jogosultságai időközben megváltoztak. Kérj új meghívást.");
            var existing = await db.Memberships.WithAccess().SingleOrDefaultAsync(item => item.TenantId == TenantId && item.UserSubject == userId, ct);
            if (existing is not null && (existing.HasCompanyAccess || !existing.IsActive))
                throw Error(409, "already_member", "Már van tagságod ennél a cégnél; a meghívó nem írhatja felül a hozzáférésedet.");
            var member = existing ?? new TenantMembership
            {
                TenantId = TenantId, UserSubject = userId, JoinedAt = DateTimeOffset.UtcNow,
                Permissions = grants.Select(code => new MembershipPermission { TenantId = TenantId, UserSubject = userId, Code = code }).ToList()
            };
            if (existing is null) db.Memberships.Add(member);
            else
            {
                member.HasDirectAccess = true;
                member.Version++;
                member.Permissions.AddRange(grants.Select(code => new MembershipPermission { TenantId = TenantId, UserSubject = userId, Code = code }));
            }
            invitation.AcceptedAt = DateTimeOffset.UtcNow;
            Audit("invitation.accepted", userId, new { invitationId = invitation.Id, permissions = grants });
            await db.SaveChangesAsync(ct);
            return Access(member);
        }, ct);
    }
    public Task<PageResult<AuditSummary>> AuditAsync(int page, int pageSize, CancellationToken ct) => Scoped<PageResult<AuditSummary>>(async () =>
    {
        var offset = Offset(page, pageSize);
        var query = db.AccessAuditEvents.AsNoTracking();
        var items = await query.OrderByDescending(item => item.CreatedAt).ThenByDescending(item => item.Id).Skip(offset).Take(pageSize)
            .Select(item => new AuditSummary(item.Id, item.ActorSubject, item.Action, item.TargetSubject, item.Details, item.CreatedAt)).ToArrayAsync(ct);
        var names = await IdentityHistory.Resolve(db, items.SelectMany(x => new[] { x.ActorSubject, x.TargetSubject }), ct);
        return new(items.Select(x => x with
        {
            ActorSubject = IdentityHistory.Subject(names, x.ActorSubject),
            TargetSubject = x.TargetSubject is null ? null : IdentityHistory.Subject(names, x.TargetSubject),
            OriginalActorSubject = names.TryGetValue(x.ActorSubject, out var actor) && actor != x.ActorSubject ? x.ActorSubject : null,
            OriginalTargetSubject = x.TargetSubject is { } target && names.TryGetValue(target, out var name) && name != target ? target : null
        }).ToArray(), await query.CountAsync(ct), page, pageSize);
    }, ct);
}
