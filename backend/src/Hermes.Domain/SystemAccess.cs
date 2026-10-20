namespace Hermes.Domain;

// A directly assigned global permission, independent of company memberships and roles.
public static class SystemPermissions
{
    public const string Manage = "system.manage";
}

public sealed class SystemPermissionGrant
{
    public required string UserId { get; init; }
    public required string Code { get; init; }
}

public sealed class SystemAuditEvent
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string ActorSubject { get; init; }
    public string? TargetSubject { get; init; }
    public Guid? TenantId { get; init; }
    public required string Action { get; init; }
    public required string Details { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
