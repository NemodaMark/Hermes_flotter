namespace Hermes.Domain;

public sealed class VehiclePhoto : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public int Slot { get; init; }
    public required byte[] Bytes { get; init; }
    public required string Sha256 { get; init; }
    public required string UploadedBy { get; init; }
    public DateTimeOffset UploadedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed class VehicleUserAssignment : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public required string UserId { get; init; }
    public required string AssignedBy { get; init; }
    public DateTimeOffset AssignedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ReleasedAt { get; set; }
    public string? ReleasedBy { get; set; }
}

public sealed class VehicleModelOption : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string MakeKey { get; init; }
    public required string ModelKey { get; init; }
    public required string Make { get; init; }
    public required string Model { get; init; }
}
