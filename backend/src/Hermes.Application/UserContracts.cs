namespace Hermes.Application;

public sealed record UserProfile(string Id, string DisplayName, string Email, string? PhoneNumber,
    long Version, bool PasswordChangeRequired, DateTimeOffset? PasswordChangeRequestedAt,
    DateTimeOffset? PasswordChangedAt, string[] SystemPermissions)
{
    public bool IsAdministrator { get; init; }
    public UserCompanyAccess[] CompanyAccess { get; init; } = [];
}
public sealed record UserCompanyAccess(Guid Id, string Name, bool HasAccess, bool IsAdmin, bool IsSuspended);
public sealed record EditUserProfileRequest(string DisplayName, string Email, string? PhoneNumber, long Version);
public sealed record UserVersionRequest(long Version);
public sealed record ChangeSystemAccessRequest(bool? Enabled, long Version);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword, string ConfirmPassword);
public sealed record SystemAuditSummary(Guid Id, string ActorSubject, string? TargetSubject, Guid? TenantId,
    string Action, string Details, DateTimeOffset CreatedAt)
{
    public string? OriginalActorSubject { get; init; }
    public string? OriginalTargetSubject { get; init; }
}
