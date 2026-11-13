using System.Globalization;
using System.Text;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Http.Features;

namespace Hermes.Api;

public static class FleetOperationsEndpoints
{
    public static void MapFleetOperations(this WebApplication app)
    {
        var vehicles = app.MapGroup("/api/v1/vehicles/{id:guid}").RequireAuthorization().WithMetadata(new TenantRequired());

        vehicles.MapGet("/bookings", async (Guid id, DateOnly month, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.Bookings(id, month, ct))).RequireAuthorization(Permissions.BookingsRead, Permissions.VehiclesRead);
        vehicles.MapPut("/booking-settings", async (Guid id, BookingSettingsInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.SetBooking(id, body, ct))).RequireAuthorization(Permissions.BookingsManage);
        vehicles.MapGet("/booking-settings", async (Guid id, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.BookingSetting(id, ct))).RequireAuthorization(Permissions.BookingsManage);
        vehicles.MapPost("/bookings", async (Guid id, BookingInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.Book(id, body, ct))).RequireAuthorization(Permissions.BookingsCreate, Permissions.VehiclesRead);
        vehicles.MapDelete("/bookings/{booking:guid}", async (Guid id, Guid booking, bool? manage, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.CancelBooking(id, booking, manage == true, ct))).RequireAuthorization(Permissions.VehiclesRead);

        vehicles.MapGet("/service-appointment", async (Guid id, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(new { appointment = await fleet.ServiceAppointment(id, ct) })).RequireAuthorization(Permissions.ServicesRead);
        vehicles.MapPut("/service-appointment", async (Guid id, ServiceAppointmentInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.PlanService(id, body, ct))).RequireAuthorization(Permissions.ServicesManage);
        vehicles.MapDelete("/service-appointment", async (Guid id, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.PlanService(id, null, ct))).RequireAuthorization(Permissions.ServicesManage);

        vehicles.MapGet("/fuel", async (Guid id, DateOnly month, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.Fuel(id, month, ct))).RequireAuthorization(Permissions.FuelRead);
        vehicles.MapGet("/fuel/export", async (Guid id, DateOnly month, FleetManagement fleet, HttpContext http, CancellationToken ct) =>
        {
            var entries = await fleet.Fuel(id, month, ct);
            var csv = new StringBuilder("Dátum;Kilométerállás;Liter;Összeg;Pénznem\r\n");
            var culture = CultureInfo.GetCultureInfo("hu-HU");
            foreach (var row in entries.Items.Where(x => !x.IsVoided))
                csv.Append(CultureInfo.InvariantCulture, $"{row.FueledOn:yyyy-MM-dd};{row.Kilometers};{row.Liters.ToString("0.###", culture)};{row.Amount.ToString("0.00", culture)};{row.Currency}\r\n");
            http.Response.Headers.CacheControl = "private, no-store";
            return Results.File(Encoding.UTF8.GetBytes("\uFEFF" + csv), "text/csv; charset=utf-8", $"tankolas-{month:yyyy-MM}.csv");
        }).RequireAuthorization(Permissions.FuelRead);
        vehicles.MapPost("/fuel", async (Guid id, HttpContext http, FleetManagement fleet, CancellationToken ct) =>
        {
            await fleet.CheckOperationUpload(id, true, ct);
            var (input, image) = await OperationForm<FuelEntryInput>(http.Request, ct);
            return Results.Ok(await fleet.RecordFuel(id, input, image, ct));
        }).RequireAuthorization(Permissions.FuelManage);
        vehicles.MapPost("/fuel/{entry:guid}/void", async (Guid id, Guid entry, FuelVoidInput body, FleetManagement fleet, CancellationToken ct)
            => Results.Ok(await fleet.VoidFuel(id, entry, body.Reason, ct))).RequireAuthorization(Permissions.FuelManage);
        vehicles.MapGet("/fuel/{entry:guid}/receipt", async (Guid id, Guid entry, HttpContext http, FleetManagement fleet, CancellationToken ct)
            => PeopleAndMediaEndpoints.Image(http, await fleet.OperationImage(id, entry, true, ct))).RequireAuthorization(Permissions.FuelRead);

        vehicles.MapGet("/handovers", async (Guid id, FleetManagement fleet, CancellationToken ct, int page = 1)
            => Results.Ok(await fleet.Handovers(id, page, ct))).RequireAuthorization(Permissions.VehiclesRead);
        vehicles.MapPost("/handovers", async (Guid id, HttpContext http, FleetManagement fleet, CancellationToken ct) =>
        {
            await fleet.CheckOperationUpload(id, false, ct);
            var (input, image) = await OperationForm<HandoverInput>(http.Request, ct);
            return Results.Ok(await fleet.Handover(id, input, image, ct));
        }).RequireAuthorization(Permissions.VehiclesAssignUsers, Permissions.OdometerCreate);
        vehicles.MapGet("/handovers/{entry:guid}/photo", async (Guid id, Guid entry, HttpContext http, FleetManagement fleet, CancellationToken ct)
            => PeopleAndMediaEndpoints.Image(http, await fleet.OperationImage(id, entry, false, ct))).RequireAuthorization(Permissions.VehiclesRead);
    }

    private sealed record FuelVoidInput(string Reason);

    private static async Task<(T Data, byte[]? Image)> OperationForm<T>(HttpRequest request, CancellationToken ct) where T : class
    {
        const int max = ImageProcessing.MaxBytes + 16 * 1024;
        if (request.ContentLength > max) throw UserAccounts.Error(413, "image_size", "Legfeljebb 5 MB-os képet válassz.");
        if (request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = max;
        try
        {
            if (request.HasJsonContentType())
            {
                if (request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } jsonLimit) jsonLimit.MaxRequestBodySize = 16 * 1024;
                return (await request.ReadFromJsonAsync<T>(ct) ?? throw new InvalidDataException(), null);
            }
            if (!request.HasFormContentType || request.ContentType?.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase) != true)
                throw new InvalidDataException();
            var form = await request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = max, ValueCountLimit = 2, ValueLengthLimit = 8192, KeyLengthLimit = 32 }, ct);
            if (form.Count != 1 || form["data"].Count != 1 || form.Files.Count > 1) throw new InvalidDataException();
            var body = JsonSerializer.Deserialize<T>(form["data"].ToString(), JsonSerializerOptions.Web) ?? throw new InvalidDataException();
            var file = form.Files.GetFile("file");
            if (file is null)
            {
                if (form.Files.Count > 0) throw new InvalidDataException();
                return (body, null);
            }
            if (file.Length is < 1 or > ImageProcessing.MaxBytes) throw UserAccounts.Error(413, "image_size", "Legfeljebb 5 MB-os képet válassz.");
            using var output = new MemoryStream();
            await file.CopyToAsync(output, ct);
            return (body, ImageProcessing.Normalize(new(output.ToArray(), file.FileName, 1), avatar: false));
        }
        catch (Exception error) when (error is JsonException or InvalidDataException or BadHttpRequestException)
        {
            throw UserAccounts.Error(400, "operation_form", "Érvénytelen űrlap vagy csatolmány.");
        }
    }

}
