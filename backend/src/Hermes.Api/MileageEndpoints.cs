using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;

namespace Hermes.Api;

public static class MileageEndpoints
{
    public static void MapMileage(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/mileage").RequireAuthorization().WithMetadata(new TenantRequired());
        api.MapGet("/accounts", async (FleetManagement fleet, CancellationToken ct) => Results.Ok(await fleet.MileageUsers(ct)))
            .RequireAuthorization(Permissions.MileageManage);
        api.MapPut("/accounts/{userId}", async (string userId, MileageAccountInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SetMileageLimit(userId, body, ct))).RequireAuthorization(Permissions.MileageManage);
        api.MapGet("/months/current", async (string? userId, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.ReadMileage(userId, null, ct)));
        api.MapGet("/months/{month}", async (DateOnly month, string? userId, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.ReadMileage(userId, month, ct)));
        api.MapPut("/months/{month}/mode", async (DateOnly month, string? userId, MileageModeInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SetMileageMode(userId, month, body, ct)));
        api.MapPut("/months/{month}", async (DateOnly month, string? userId, MileageMonthInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SaveMileageMonth(userId, month, body, ct)));
        api.MapPost("/months/{month}/entries", async (DateOnly month, string? userId, MileageEntryInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SaveMileageEntry(userId, month, null, body, false, ct)));
        api.MapPut("/months/{month}/entries/{entry:guid}", async (DateOnly month, Guid entry, string? userId, MileageEntryInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SaveMileageEntry(userId, month, entry, body, false, ct)));
        api.MapPost("/months/{month}/entries/{entry:guid}/void", async (DateOnly month, Guid entry, string? userId, MileageEntryInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SaveMileageEntry(userId, month, entry, body, true, ct)));
    }
}
