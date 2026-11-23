namespace Hermes.Domain;

public sealed class FuelSettlementPolicy : ITenantEntity
{
    public Guid TenantId { get; init; }
    public DateOnly Month { get; init; }
    public required string Rules { get; set; }
    public long Version { get; set; } = 1;
}
public sealed class FuelSettlement : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserId { get; init; }
    public DateOnly Month { get; init; }
    public required string Data { get; set; }
    public required string Calculation { get; set; }
    public string Status { get; set; } = "Draft";
    public long Version { get; set; } = 1;
    public required string UpdatedBy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? ApprovedBy { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
}
public sealed class FuelSettlementVehicle : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserId { get; init; }
    public DateOnly Month { get; init; }
    public Guid VehicleId { get; init; }
    public byte[]? SourceWorkbook { get; init; }
    public string? SourceMetadata { get; init; }
}
public sealed class FuelSettlementHistory : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserId { get; init; }
    public DateOnly Month { get; init; }
    public long Version { get; init; }
    public required string Snapshot { get; init; }
    public required string Status { get; init; }
    public required string Actor { get; init; }
    public string? Reason { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
