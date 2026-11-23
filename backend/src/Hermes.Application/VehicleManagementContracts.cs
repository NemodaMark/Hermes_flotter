namespace Hermes.Application;

public sealed record VehicleSpecification
{
    public string RegistrationCountry { get; init; } = "HU";
    public string? Vin { get; init; }
    public string? FleetNumber { get; init; }
    public string Category { get; init; } = "Unknown";
    public string BodyType { get; init; } = "Unknown";
    public int? Year { get; init; }
    public DateOnly? FirstRegistration { get; init; }
    public string? Color { get; init; }
    public string FuelType { get; init; } = "Unknown";
    public decimal? PowerKw { get; init; }
    public int? EngineCapacityCc { get; init; }
    public string Transmission { get; init; } = "Unknown";
    public int? Seats { get; init; }
    public int? GrossWeightKg { get; init; }
    public int? PayloadKg { get; init; }
    public decimal? CargoVolumeM3 { get; init; }
    public decimal? BatteryKwh { get; init; }
    public string Ownership { get; init; } = "Unknown";
    public DateOnly? FleetEntryDate { get; init; }
    public DateOnly? FleetExitDate { get; init; }
    public DateOnly? InspectionDueDate { get; init; }
    public DateOnly? InsuranceDueDate { get; init; }
    public DateOnly? NextServiceDate { get; init; }
    public long? NextServiceKm { get; init; }
    public Guid? PreferredServicePartnerId { get; init; }
    public string? Notes { get; init; }
}
public sealed record VehicleRecord(VehicleSummary Vehicle, VehicleSpecification Data, string? PreferredServicePartnerName,
    string? StatusReason, DateTimeOffset? UpdatedAt, string? UpdatedBy)
{
    public bool? BookingEnabled { get; init; }
}
public sealed record SaveVehicleRecord(string Registration, string Make, string Model, string Status, long Version, VehicleSpecification Data);
public sealed record VehicleStateInput(bool? IsArchived, string Reason, long Version);
public sealed record VersionReason(long Version, string Reason);
public sealed record VehicleMoveOptions(bool CanUnassign, VehicleSiteOption[] Sites);
public sealed record RegistrationEntry(Guid Id, string Registration, string CountryCode, string RecordedBy, DateTimeOffset RecordedAt);
public sealed record OdometerEntry(Guid Id, long Kilometers, string RecordedBy, DateTimeOffset RecordedAt);
public sealed record PartnerContactInput(string Name, string? Position, string? Email, string? Phone);
public sealed record PartnerInput(string Name, bool IsLessor, bool IsService, AddressInput Address,
    string? Email, string? Phone, string? Website, string? Notes, PartnerContactInput[] Contacts, long Version = 0);
public sealed record PartnerDetails(Guid Id, PartnerInput Data, bool IsArchived, string? StatusReason,
    DateTimeOffset CreatedAt, string CreatedBy, DateTimeOffset? UpdatedAt, string? UpdatedBy);
public sealed record PartnerOption(Guid Id, string Name);
public sealed record LeaseInput(Guid PartnerId, string ContractNumber, DateOnly StartDate, DateOnly EndDate,
    decimal? PaymentAmount, string Currency, string BillingFrequency, long? AnnualKmLimit, long? TotalKmLimit,
    string Status, string? DocumentUrl, string? Notes, long Version = 0);
public sealed record LeaseDetails(Guid Id, string PartnerName, LeaseInput Data,
    DateTimeOffset CreatedAt, string CreatedBy, DateTimeOffset? UpdatedAt, string? UpdatedBy);
public sealed record ServiceInput(Guid PartnerId, DateOnly PerformedOn, long? Kilometers, string Description,
    string? WorkOrderNumber, decimal? Cost, string Currency, DateOnly? NextServiceDate, long? NextServiceKm,
    string? DocumentUrl, string? Notes, long Version = 0);
public sealed record ServiceDetails(Guid Id, string PartnerName, ServiceInput Data, bool IsVoided, string? VoidReason,
    DateTimeOffset CreatedAt, string CreatedBy, DateTimeOffset? UpdatedAt, string? UpdatedBy);
