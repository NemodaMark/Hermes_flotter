using Hermes.Domain;

namespace Hermes.Application;

public interface ITenantContext
{
    Guid? TenantId { get; }
    string? UserSubject { get; }
    IReadOnlySet<string> Permissions { get; }
}

public sealed record TenantSummary(Guid Id, string Name, string[] Permissions)
{
    public PermissionSiteScope[] PermissionScopes { get; init; } = [];
}
public sealed record TenantAccess(Guid TenantId, string UserId, bool IsActive, long Version, string[] Permissions)
{
    public string[] DirectPermissions { get; init; } = [];
    public AssignedGroup[] Groups { get; init; } = [];
}
public sealed record CreateTenantRequest(string Name);
public sealed record VehicleSummary(Guid Id, string Registration, string Make, string Model, string Status)
{
    public long Version { get; init; } = 1;
    public long? OdometerKm { get; init; }
    public Guid? SiteId { get; init; }
    public string? SiteName { get; init; }
    public string[] Permissions { get; init; } = [];
    public string[] PreviousRegistrations { get; init; } = [];
    public VehicleBookingAvailability? BookingAvailability { get; init; }
}
public sealed record VehicleBookingAvailability(string? CurrentUser, DateOnly AvailableFrom);
public sealed record CreateVehicleRequest(string Registration, string Make, string Model, Guid? SiteId = null,
    VehicleSpecification? Data = null, string Status = "Active", long? OdometerKm = null);
public sealed record VehicleSiteOption(Guid Id, string Name, string Code);
public sealed record VehicleCreationOptions(bool CanCreateUnassigned, VehicleSiteOption[] Sites)
{
    public PartnerOption[] ServicePartners { get; init; } = [];
}
public sealed record UpdateVehicleRequest(string Registration, string Make, string Model, long Version);
public sealed record RecordOdometerRequest(long? Kilometers, long Version, MileageUsageInput? Usage = null);
public sealed record VehicleListQuery(int Page = 1, int PageSize = 25, string? Search = null,
    string Status = "all", string SiteId = "all");
public sealed record VehicleListPage(VehicleSummary[] Items, int Total, int AvailableTotal, int Page, int PageSize);

public interface ITenantDirectory
{
    Task<IReadOnlyList<TenantSummary>> ListForUserAsync(string subject, CancellationToken cancellationToken, bool includeInactive = false);
    Task<TenantMembership?> FindMembershipAsync(string subject, Guid tenantId, CancellationToken cancellationToken, bool includeInactive = false);
    Task<TenantSummary> CreateForUserAsync(string subject, CreateTenantRequest request, CancellationToken cancellationToken);
}

public interface IVehicleStore
{
    Task<VehicleSiteOption[]> ReadSiteOptionsAsync(CancellationToken ct);
    Task<VehicleCreationOptions> CreationOptionsAsync(CancellationToken ct);
    Task<IReadOnlyList<VehicleSummary>> ListAsync(CancellationToken cancellationToken);
    Task<VehicleListPage> SearchAsync(VehicleListQuery query, CancellationToken cancellationToken);
    Task<VehicleSummary?> GetAsync(Guid id, CancellationToken cancellationToken);
    Task<VehicleSummary> CreateAsync(CreateVehicleRequest request, CancellationToken cancellationToken);
    Task<VehicleSummary> UpdateAsync(Guid id, UpdateVehicleRequest request, CancellationToken ct);
    Task<VehicleSummary> RecordOdometerAsync(Guid id, RecordOdometerRequest request, CancellationToken ct);
}

public static class VehicleValidation
{
    public static Dictionary<string, string[]> Validate(CreateVehicleRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        ValidateField(errors, "registration", request.Registration, 16);
        ValidateField(errors, "make", request.Make, 64);
        ValidateField(errors, "model", request.Model, 64);
        return errors;
    }

    private static void ValidateField(Dictionary<string, string[]> errors, string field, string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
            errors[field] = ["A mező kitöltése kötelező."];
        else if (value.Trim().Length > maxLength)
            errors[field] = [$"Legfeljebb {maxLength} karakter adható meg."];
    }
}
