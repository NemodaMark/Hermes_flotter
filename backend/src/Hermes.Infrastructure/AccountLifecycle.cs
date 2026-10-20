namespace Hermes.Infrastructure;

// Keep identities and audit references while removing retired accounts from active use.
public sealed class AccountLifecycle
{
    public required string UserId { get; init; }
    public bool IsArchived { get; set; }
    public bool DevelopmentOnly { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public string? Reason { get; set; }
}

public sealed class ArchivedTenant
{
    public Guid TenantId { get; init; }
    public DateTimeOffset ArchivedAt { get; init; } = DateTimeOffset.UtcNow;
    public required string Reason { get; init; }
}
