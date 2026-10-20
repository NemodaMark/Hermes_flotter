using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hermes.Api;

public static class FleetManagementEndpoints
{
    public static void MapFleetManagementEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization().WithMetadata(new TenantRequired());
        var partners = api.MapGroup("/partners");
        partners.MapGet("/", async (FleetManagement service, CancellationToken ct, int page = 1, string? search = null, string kind = "all", bool includeArchived = false)
            => Results.Ok(await service.Partners(page, search, kind, includeArchived, ct))).RequireAuthorization(Permissions.PartnersRead);
        partners.MapGet("/{id:guid}", async (Guid id, FleetManagement service, CancellationToken ct) => Results.Ok(await service.GetPartner(id, ct))).RequireAuthorization(Permissions.PartnersRead);
        partners.MapGet("/{id:guid}/audit-events", async (Guid id, FleetManagement service, CancellationToken ct, int page = 1)
            => Results.Ok(await service.History(id, false, page, ct))).RequireAuthorization(Permissions.PartnersRead, Permissions.AuditRead);
        partners.MapPost("/", async (PartnerInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SavePartner(null, input, ct))).RequireAuthorization(Permissions.PartnersCreate);
        partners.MapPut("/{id:guid}", async (Guid id, PartnerInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SavePartner(id, input, ct))).RequireAuthorization(Permissions.PartnersUpdate);
        partners.MapPatch("/{id:guid}/status", async (Guid id, ChangeArchiveStatus input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.PartnerStatus(id, input, ct))).RequireAuthorization(Permissions.PartnersArchive);

        var vehicles = api.MapGroup("/vehicles/{vehicleId:guid}");
        vehicles.MapGet("/details", async (Guid vehicleId, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.GetVehicle(vehicleId, ct))).RequireAuthorization(Permissions.VehiclesRead);
        vehicles.MapGet("/site-options", async (Guid vehicleId, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SiteOptions(vehicleId, ct))).RequireAuthorization(Permissions.SitesAssignVehicles, Permissions.VehiclesRead);
        vehicles.MapGet("/audit-events", async (Guid vehicleId, FleetManagement service, CancellationToken ct, int page = 1)
            => Results.Ok(await service.History(vehicleId, true, page, ct))).RequireAuthorization(Permissions.AuditRead);
        vehicles.MapPut("/details", async (Guid vehicleId, SaveVehicleRecord input, FleetManagement service, CancellationToken ct) =>
        {
            try { return Results.Ok(await service.SaveVehicle(vehicleId, input, ct)); }
            catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            { return Results.Problem(statusCode: 409, title: "Ez a rendszám, alvázszám vagy flottaazonosító már szerepel a cég járművei között."); }
        }).RequireAuthorization(Permissions.VehiclesUpdate);
        vehicles.MapPatch("/status", async (Guid vehicleId, VehicleStateInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.VehicleStatus(vehicleId, input, ct))).RequireAuthorization(Permissions.VehiclesArchive);
        vehicles.MapGet("/registrations", async (Guid vehicleId, FleetManagement service, CancellationToken ct, int page = 1)
            => Results.Ok(await service.Registrations(vehicleId, page, ct))).RequireAuthorization(Permissions.VehiclesRead);
        vehicles.MapGet("/odometer", async (Guid vehicleId, FleetManagement service, CancellationToken ct, int page = 1)
            => Results.Ok(await service.Odometer(vehicleId, page, ct))).RequireAuthorization(Permissions.VehiclesRead);
        // Purpose-specific authorization, including the vehicle's site, is performed under the company lock.
        vehicles.MapGet("/partner-options", async (Guid vehicleId, string purpose, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.PartnerOptions(vehicleId, purpose, ct)));
        vehicles.MapGet("/leases", async (Guid vehicleId, FleetManagement service, CancellationToken ct, int page = 1)
            => Results.Ok(await service.Leases(vehicleId, page, ct))).RequireAuthorization(Permissions.LeasingRead);
        vehicles.MapPost("/leases", async (Guid vehicleId, LeaseInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SaveLease(vehicleId, null, input, ct))).RequireAuthorization(Permissions.LeasingManage);
        vehicles.MapPut("/leases/{id:guid}", async (Guid vehicleId, Guid id, LeaseInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SaveLease(vehicleId, id, input, ct))).RequireAuthorization(Permissions.LeasingManage);
        vehicles.MapGet("/services", async (Guid vehicleId, FleetManagement service, CancellationToken ct, int page = 1, bool includeVoided = false)
            => Results.Ok(await service.Services(vehicleId, page, includeVoided, ct))).RequireAuthorization(Permissions.ServicesRead);
        vehicles.MapPost("/services", async (Guid vehicleId, ServiceInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SaveService(vehicleId, null, input, ct))).RequireAuthorization(Permissions.ServicesManage);
        vehicles.MapPut("/services/{id:guid}", async (Guid vehicleId, Guid id, ServiceInput input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.SaveService(vehicleId, id, input, ct))).RequireAuthorization(Permissions.ServicesManage);
        vehicles.MapPost("/services/{id:guid}/void", async (Guid vehicleId, Guid id, VersionReason input, FleetManagement service, CancellationToken ct)
            => Results.Ok(await service.VoidService(vehicleId, id, input, ct))).RequireAuthorization(Permissions.ServicesManage);
    }
}
