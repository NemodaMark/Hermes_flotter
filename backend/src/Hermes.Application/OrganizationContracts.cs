namespace Hermes.Application;

public sealed record CompanyRow(Guid Id, string Name, string Status, string[] Permissions);
public sealed record AddressInput(string CountryCode, string? PostalCode, string? City, string? AddressLine1, string? AddressLine2);
public sealed record CompanyInput(string Name, string? LegalName, string? TaxNumber, string? RegistrationNumber,
    string? EuVatNumber, AddressInput Address, string? Email, string? Phone, string? Website,
    string TimeZone, string Currency, string DistanceUnit, long Version);
public sealed record CompanyDetails(Guid Id, CompanyInput Data, string Status, string? StatusReason,
    DateTimeOffset? StatusChangedAt, DateTimeOffset? CreatedAt, string? CreatedBy, DateTimeOffset? UpdatedAt, string? UpdatedBy);
public sealed record ChangeCompanyStatus(string Status, string Reason, long Version);
public sealed record CompanyState(long Version, string Status, string? Reason, DateTimeOffset? ChangedAt);
public sealed record ChangeArchiveStatus(bool? IsArchived, string Reason, long Version);
public sealed record ContactInput(string Name, string? Position, string? Email, string? Phone, long Version = 0);
public sealed record ContactDetails(Guid Id, ContactInput Data, bool IsArchived, string? StatusReason,
    DateTimeOffset? ArchivedAt, DateTimeOffset CreatedAt, string CreatedBy, DateTimeOffset? UpdatedAt, string? UpdatedBy);
public sealed record SiteInput(string Name, string Code, AddressInput Address, string? Email, string? Phone, Guid? ContactId, long Version = 0);
public sealed record SiteDetails(Guid Id, SiteInput Data, string? ContactName, bool IsArchived, string? StatusReason,
    DateTimeOffset? ArchivedAt, int VehicleCount, DateTimeOffset CreatedAt, string CreatedBy, DateTimeOffset? UpdatedAt, string? UpdatedBy);
public sealed record SiteVehicle(Guid Id, string Registration, string Make, string Model, Guid? SiteId, string? SiteName, long Version);
public sealed record AssignVehicleSite(Guid? SiteId, long Version);
