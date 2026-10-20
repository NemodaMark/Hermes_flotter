namespace Hermes.Domain;

// The UUID and the company never change when a registration or contract changes.
public sealed class VehicleProfile : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid VehicleId { get; init; }
    public string RegistrationCountry { get; set; } = "HU";
    public string? Vin { get; set; }
    public string? FleetNumber { get; set; }
    public string Category { get; set; } = "Unknown";
    public string BodyType { get; set; } = "Unknown";
    public int? Year { get; set; }
    public DateOnly? FirstRegistration { get; set; }
    public string? Color { get; set; }
    public string FuelType { get; set; } = "Unknown";
    public decimal? PowerKw { get; set; }
    public int? EngineCapacityCc { get; set; }
    public string Transmission { get; set; } = "Unknown";
    public int? Seats { get; set; }
    public int? GrossWeightKg { get; set; }
    public int? PayloadKg { get; set; }
    public decimal? CargoVolumeM3 { get; set; }
    public decimal? BatteryKwh { get; set; }
    public string Ownership { get; set; } = "Unknown";
    public DateOnly? FleetEntryDate { get; set; }
    public DateOnly? FleetExitDate { get; set; }
    public DateOnly? InspectionDueDate { get; set; }
    public DateOnly? InsuranceDueDate { get; set; }
    public DateOnly? NextServiceDate { get; set; }
    public long? NextServiceKm { get; set; }
    public Guid? PreferredServicePartnerId { get; set; }
    public string? Notes { get; set; }
    public string? StatusReason { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public sealed class VehicleRegistration : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public required string Registration { get; init; }
    public required string CountryCode { get; init; }
    public required string RecordedBy { get; init; }
    public DateTimeOffset RecordedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed class Partner : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public string SearchText { get; set; } = "";
    public bool IsLessor { get; set; }
    public bool IsService { get; set; }
    public string CountryCode { get; set; } = "HU";
    public string? PostalCode { get; set; }
    public string? City { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Website { get; set; }
    public string? Notes { get; set; }
    // Contact snapshots are versioned and audited together with the partner.
    public string ContactsJson { get; set; } = "[]";
    public bool IsArchived { get; set; }
    public string? StatusReason { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public required string CreatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public sealed class VehicleLease : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public Guid PartnerId { get; set; }
    public required string ContractNumber { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public decimal? PaymentAmount { get; set; }
    public string Currency { get; set; } = "HUF";
    public string BillingFrequency { get; set; } = "Monthly";
    public long? AnnualKmLimit { get; set; }
    public long? TotalKmLimit { get; set; }
    public string Status { get; set; } = "Active";
    public string? DocumentUrl { get; set; }
    public string? Notes { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public required string CreatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public sealed class VehicleService : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public Guid PartnerId { get; set; }
    public DateOnly PerformedOn { get; set; }
    public long? Kilometers { get; set; }
    public required string Description { get; set; }
    public string? WorkOrderNumber { get; set; }
    public decimal? Cost { get; set; }
    public string Currency { get; set; } = "HUF";
    public DateOnly? NextServiceDate { get; set; }
    public long? NextServiceKm { get; set; }
    public string? DocumentUrl { get; set; }
    public string? Notes { get; set; }
    public bool IsVoided { get; set; }
    public string? VoidReason { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public required string CreatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}
