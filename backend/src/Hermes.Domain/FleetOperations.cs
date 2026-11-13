namespace Hermes.Domain;

public sealed class VehicleBookingSettings : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid VehicleId { get; init; }
    public bool Enabled { get; set; }
}

public sealed class VehicleBooking : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public required string UserId { get; init; }
    public DateOnly StartsOn { get; init; }
    public DateOnly EndsOn { get; init; }
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancelledBy { get; set; }
}

public sealed class VehicleServiceAppointment : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid VehicleId { get; init; }
    public DateTimeOffset StartsAt { get; set; }
    public string? Notes { get; set; }
}

public sealed class VehicleFuelEntry : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public DateOnly FueledOn { get; init; }
    public long Kilometers { get; init; }
    public decimal Liters { get; init; }
    public decimal Amount { get; init; }
    public required string Currency { get; init; }
    public required string RecordedBy { get; init; }
    public byte[]? Receipt { get; init; }
    public DateTimeOffset? VoidedAt { get; set; }
}

public sealed class VehicleHandover : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public string? PreviousUserId { get; init; }
    public string? NextUserId { get; init; }
    public required string RecordedBy { get; init; }
    public DateTimeOffset RecordedAt { get; init; }
    public long Kilometers { get; init; }
    public required string Condition { get; init; }
    public string? Notes { get; init; }
    public byte[]? Photo { get; init; }
}

public sealed class VehicleReminderDelivery : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid VehicleId { get; init; }
    public required string UserId { get; init; }
    public required string EventKey { get; init; }
    public DateTimeOffset RetryAfter { get; set; }
    public bool Delivered { get; set; }
}
