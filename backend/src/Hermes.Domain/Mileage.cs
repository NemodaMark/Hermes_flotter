namespace Hermes.Domain;

public sealed class MileageAccount : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserId { get; init; }
    public string Mode { get; set; } = "Entries";
    public long? MonthlyLimitKm { get; set; }
    public DateOnly FirstMonth { get; set; }
    public long Version { get; set; } = 1;
}

public sealed class MileageMonth : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserId { get; init; }
    public DateOnly Month { get; init; }
    public string Mode { get; set; } = "Entries";
    public long TotalKm { get; set; }
    public long PrivateKm { get; set; }
    public long? LimitKm { get; set; }
    public bool LimitCaptured { get; set; }
    public DateTimeOffset? SubmittedAt { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public required string UpdatedBy { get; set; }
}

public sealed class MileageEntry : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string UserId { get; init; }
    public DateOnly Month { get; init; }
    public Guid? VehicleId { get; init; }
    public long? StartKilometers { get; set; }
    public long? EndKilometers { get; init; }
    public DateOnly OccurredOn { get; set; }
    public long TotalKm { get; set; }
    public long PrivateKm { get; set; }
    public required string Source { get; init; }
    public Guid? SourceId { get; init; }
    public long Version { get; set; } = 1;
    public DateTimeOffset? VoidedAt { get; set; }
    public required string RecordedBy { get; init; }
    public DateTimeOffset RecordedAt { get; init; } = DateTimeOffset.UtcNow;
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}
