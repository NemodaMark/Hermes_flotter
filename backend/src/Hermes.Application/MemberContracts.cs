namespace Hermes.Application;

public sealed class ManagementException(int statusCode, string code, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
}
public sealed record PageResult<T>(T[] Items, int Total, int Page, int PageSize);
public sealed record MemberSummary(string UserId, string? DisplayName, string? Email, bool IsActive,
    long Version, string[] Permissions, DateTimeOffset? JoinedAt, DateTimeOffset? DisabledAt);
public sealed record ChangePermissionsRequest(string[] Permissions, long Version);
public sealed record ChangeMemberStatusRequest(bool? IsActive, long Version);
public sealed record CreateInvitationRequest(string Email, string[] Permissions);
public sealed record AcceptInvitationRequest(Guid TenantId, Guid InvitationId, string Token);
public sealed record InvitationSummary(Guid Id, string Email, string[] Permissions, DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt, DateTimeOffset? AcceptedAt, DateTimeOffset? RevokedAt);
public sealed record CreatedInvitation(InvitationSummary Invitation, AcceptInvitationRequest Acceptance);
public sealed record AuditSummary(Guid Id, string ActorSubject, string Action, string? TargetSubject, string Details, DateTimeOffset CreatedAt)
{
    public string? OriginalActorSubject { get; init; }
    public string? OriginalTargetSubject { get; init; }
}

public interface IMemberManagement
{
    Task<PageResult<MemberSummary>> ListAsync(int page, int pageSize, string? search, CancellationToken ct);
    Task<MemberSummary> GetAsync(string userId, CancellationToken ct);
    Task<TenantAccess> GetAccessAsync(string userId, CancellationToken ct);
    Task<TenantAccess> ChangePermissionsAsync(string userId, ChangePermissionsRequest request, CancellationToken ct);
    Task<TenantAccess> ChangeStatusAsync(string userId, ChangeMemberStatusRequest request, CancellationToken ct);
    Task<CreatedInvitation> InviteAsync(CreateInvitationRequest request, CancellationToken ct);
    Task<PageResult<InvitationSummary>> InvitationsAsync(int page, int pageSize, CancellationToken ct);
    Task RevokeAsync(Guid id, CancellationToken ct);
    Task<TenantAccess> AcceptAsync(string userId, string normalizedEmail, AcceptInvitationRequest request, CancellationToken ct);
    Task<PageResult<AuditSummary>> AuditAsync(int page, int pageSize, CancellationToken ct);
}
