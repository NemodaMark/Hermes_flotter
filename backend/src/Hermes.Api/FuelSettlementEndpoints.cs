using System.Globalization;
using System.Text;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http.Features;

namespace Hermes.Api;

public static class FuelSettlementEndpoints
{
    public static void MapFuelSettlements(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1/fuel-settlements").RequireAuthorization().WithMetadata(new TenantRequired());
        api.MapGet("/options", async (DateOnly month, string? userId, FleetManagement fleet, CancellationToken ct) =>
            Results.Ok(await fleet.SettlementOptions(userId, month, ct)));
        api.MapGet("/months/{month}", async (DateOnly month, string? userId, FleetManagement fleet, CancellationToken ct) =>
            Results.Ok(await fleet.ReadSettlement(userId, month, ct)));
        api.MapPost("/months/{month}/preview", async (DateOnly month, string? userId, SettlementDraft input, FleetManagement fleet, CancellationToken ct) =>
            Results.Ok(await fleet.PreviewSettlement(userId, month, input, ct)));
        api.MapPut("/months/{month}", async (DateOnly month, string? userId, SettlementDraft input, FleetManagement fleet, CancellationToken ct) =>
            Results.Ok(await fleet.SaveSettlement(userId, month, input, ct)));
        foreach (var action in new[] { "submit", "approve", "reopen" })
        {
            var operation = action;
            api.MapPost("/months/{month}/" + operation, async (DateOnly month, string? userId, SettlementAction input, FleetManagement fleet, CancellationToken ct) =>
                Results.Ok(await fleet.ChangeSettlement(userId, month, operation, input, ct)));
        }
        api.MapGet("/months/{month}/history", async (DateOnly month, string? userId, FleetManagement fleet, CancellationToken ct) =>
            Results.Ok(await fleet.SettlementHistory(userId, month, ct)));
        api.MapGet("/months/{month}/sources/{vehicle:guid}", async (DateOnly month, string? userId, Guid vehicle, FleetManagement fleet, HttpContext http, CancellationToken ct) => {
            var bytes = await fleet.SettlementSourceFile(userId, month, vehicle, ct);
            http.Response.Headers.CacheControl = "private, no-store";
            return Results.File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"elszamolas-forras-{month:yyyy-MM}.xlsx");
        });
        api.MapPut("/policies/{month}", async (DateOnly month, SettlementPolicyInput input, FleetManagement fleet, CancellationToken ct) =>
            Results.Ok(await fleet.SaveSettlementPolicy(month, input, ct))).RequireAuthorization(Permissions.SettlementsConfigure);
        api.MapGet("/months/{month}/export", async (DateOnly month, string? userId, FleetManagement fleet, HttpContext http, CancellationToken ct) => {
            var report = await fleet.ReadSettlement(userId, month, ct);
            if (report.Status != "Approved") throw new ManagementException(409, "settlement_not_approved", "Csak jóváhagyott elszámolás exportálható.");
            string Cell(string value) => "\"" + ((value.Length > 0 && "=+-@\t\r\n".Contains(value[0])) ? "'" + value : value).Replace("\"", "\"\"") + "\"";
            string Number(decimal? value) => value?.ToString("0.######", CultureInfo.GetCultureInfo("hu-HU")) ?? "";
            var csv = new StringBuilder("Hónap;Felhasználó;Rendszám;Teljes km;Magán km;Ingyenes km;Fizetős km;Üzemanyag Ft;I. sáv Ft;II. sáv Ft;Sorösszeg Ft;Jóváhagyott havi összeg Ft;Jóváhagyó;Verzió\r\n");
            var index = 0;
            foreach (var row in report.Calculation.Lines)
            {
                var input = report.Data.Lines.Single(x => x.VehicleId == row.VehicleId);
                csv.AppendLine(string.Join(';', new[] { month.ToString("yyyy-MM"), report.UserId, report.Vehicles.Single(x => x.Id == row.VehicleId).Registration,
                    Number(row.TotalKm), Number(input.PrivateKm), Number(row.FreeKm), Number(row.PaidKm), Number(row.FuelAmount), Number(row.FirstAmount), Number(row.SecondAmount),
                    Number(row.Amount), index++ == 0 ? Number(report.Calculation.Amount) : "", report.ApprovedBy!, report.Version.ToString(CultureInfo.InvariantCulture) }.Select(Cell)));
            }
            http.Response.Headers.CacheControl = "private, no-store";
            return Results.File(Encoding.UTF8.GetBytes("\uFEFF" + csv), "text/csv; charset=utf-8", $"uzemanyag-elszamolas-{month:yyyy-MM}.csv");
        });
        api.MapPost("/import/preview", async (HttpContext http, FleetManagement fleet, CancellationToken ct) => {
            var (items, _) = await Upload(http, ct);
            return Results.Ok(await fleet.PreviewSettlementImport(items, ct));
        }).RequireAuthorization(Permissions.SettlementsManage).WithMetadata(new RequestSizeLimitAttribute(101 * 1024 * 1024));
        api.MapPost("/import/draft", async (HttpContext http, FleetManagement fleet, CancellationToken ct) => {
            var (items, form) = await Upload(http, ct);
            var item = items.SingleOrDefault(x => x.Row.Id == form["rowId"].ToString()) ?? throw new ManagementException(400, "settlement_import_row", "Válassz sort az előnézetből.");
            if (!Guid.TryParse(form["vehicleId"], out var vehicle)) throw new ManagementException(400, "settlement_import_vehicle", "Válassz járművet.");
            return Results.Ok(await fleet.ImportSettlement(item, form["userId"].ToString(), vehicle, form["reason"].ToString(), ct));
        }).RequireAuthorization(Permissions.SettlementsManage).WithMetadata(new RequestSizeLimitAttribute(101 * 1024 * 1024));
    }
    private static async Task<(LegacyFuelSettlementReader.Item[], IFormCollection)> Upload(HttpContext http, CancellationToken ct)
    {
        if (!http.Request.HasFormContentType) throw new ManagementException(400, "settlement_import_file", "Fájlfeltöltés szükséges.");
        if (http.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = 101 * 1024 * 1024;
        IFormCollection form;
        try { form = await http.Request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = 101 * 1024 * 1024, ValueCountLimit = 8, ValueLengthLimit = 1024, KeyLengthLimit = 32 }, ct); }
        catch (InvalidDataException) { throw new ManagementException(400, "settlement_import_file", "Túl nagy vagy hibás fájlfeltöltés."); }
        var file = form.Files.GetFile("file");
        if (file is null || file.Length is <= 0 or > 100 * 1024 * 1024 || !int.TryParse(form["year"], out var year))
            throw new ManagementException(400, "settlement_import_file", "Legfeljebb 100 MB-os XLSX/ZIP fájlt és évet adj meg.");
        using var bytes = new MemoryStream(); await file.CopyToAsync(bytes, ct);
        return (LegacyFuelSettlementReader.Read(bytes.ToArray(), file.FileName, year), form);
    }
}
