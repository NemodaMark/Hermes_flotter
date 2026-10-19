namespace Hermes.Domain;

public enum FleetRole { Viewer, FleetManager, Owner }
public enum VehicleStatus { Active, Maintenance, Inactive }

public sealed class Tenant
{
    public Guid Id { get; init; }
    public required string Name { get; init; }
    public string TimeZone { get; init; } = "Europe/Budapest";
}

public sealed class TenantMembership
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public FleetRole Role { get; init; }
}

public sealed class Vehicle
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid TenantId { get; init; }
    public required string Registration { get; init; }
    public required string Make { get; init; }
    public required string Model { get; init; }
    public VehicleStatus Status { get; init; } = VehicleStatus.Active;
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}
