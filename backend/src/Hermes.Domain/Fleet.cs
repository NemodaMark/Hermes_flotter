namespace Hermes.Domain;

public enum VehicleStatus { Active, Maintenance, Inactive }

public sealed class Tenant
{
    public Guid Id { get; init; }
    public required string Name { get; init; }
    public string TimeZone { get; init; } = "Europe/Budapest";
}

public sealed class TenantMembership : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public bool IsActive { get; set; } = true;
    public long Version { get; set; } = 1;
    public DateTimeOffset? JoinedAt { get; init; }
    public DateTimeOffset? DisabledAt { get; set; }
    public List<MembershipPermission> Permissions { get; set; } = [];
}

public sealed class Vehicle : ITenantEntity
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid TenantId { get; init; }
    public required string Registration { get; init; }
    public required string Make { get; init; }
    public required string Model { get; init; }
    public VehicleStatus Status { get; init; } = VehicleStatus.Active;
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
