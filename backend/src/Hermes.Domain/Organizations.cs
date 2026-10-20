namespace Hermes.Domain;

public sealed class CompanyProfile : ITenantEntity
{
    public Guid TenantId { get; init; }
    public string? LegalName { get; set; }
    public string? TaxNumber { get; set; }
    public string? RegistrationNumber { get; set; }
    public string? EuVatNumber { get; set; }
    public string CountryCode { get; set; } = "HU";
    public string? PostalCode { get; set; }
    public string? City { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Website { get; set; }
    public string Currency { get; set; } = "HUF";
    public string DistanceUnit { get; set; } = "km";
    public string? StatusReason { get; set; }
    public DateTimeOffset? StatusChangedAt { get; set; }
    public long Version { get; set; } = 1;
    // Existing companies have unknown creation times; migrations must not invent history.
    public DateTimeOffset? CreatedAt { get; init; }
    public string? CreatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public sealed class CompanyContact : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public string? Position { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public string? StatusReason { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public required string CreatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public sealed class Site : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public required string Code { get; set; }
    public required string NormalizedCode { get; set; }
    public string CountryCode { get; set; } = "HU";
    public string? PostalCode { get; set; }
    public string? City { get; set; }
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public Guid? ContactId { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public string? StatusReason { get; set; }
    public long Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public required string CreatedBy { get; init; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public sealed class VehicleSiteAssignment : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid VehicleId { get; init; }
    public Guid SiteId { get; set; }
}
