using Hermes.Domain;

namespace Hermes.Application;

public interface ITenantContext
{
    Guid? TenantId { get; }
    FleetRole? Role { get; }
}

public sealed record TenantSummary(Guid Id, string Name, string Role);
public sealed record CreateTenantRequest(string Name);
public sealed record VehicleSummary(Guid Id, string Registration, string Make, string Model, string Status);
public sealed record CreateVehicleRequest(string Registration, string Make, string Model);

public interface ITenantDirectory
{
    Task<IReadOnlyList<TenantSummary>> ListForUserAsync(string subject, CancellationToken cancellationToken);
    Task<TenantMembership?> FindMembershipAsync(string subject, Guid tenantId, CancellationToken cancellationToken);
    Task<TenantSummary> CreateForUserAsync(string subject, CreateTenantRequest request, CancellationToken cancellationToken);
}

public interface IVehicleStore
{
    Task<IReadOnlyList<VehicleSummary>> ListAsync(CancellationToken cancellationToken);
    Task<VehicleSummary?> GetAsync(Guid id, CancellationToken cancellationToken);
    Task<VehicleSummary> CreateAsync(CreateVehicleRequest request, CancellationToken cancellationToken);
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
