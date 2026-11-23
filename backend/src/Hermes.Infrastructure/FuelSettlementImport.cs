using System.Security.Cryptography;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    public Task<LegacySettlementRow[]> PreviewSettlementImport(LegacyFuelSettlementReader.Item[] items, CancellationToken ct) =>
        Scoped(Permissions.SettlementsManage, _ => Task.FromResult(items.Select(x => x.Row).ToArray()), ct);

    private static SettlementCalculation CompareSources(SettlementDraft draft, SettlementCalculation calculation, IEnumerable<SettlementSource> sources)
    {
        var values = sources.ToArray();
        if (draft.AgreedAmount is null && values.Any(source => source.OriginalAmount is { } original
            && calculation.Lines.FirstOrDefault(x => x.VehicleId == source.VehicleId)?.Amount is { } amount && Math.Abs(original - amount) > 0.01m))
            return calculation with { Issues = [.. calculation.Issues, "Az Excel díja eltér. Kezelői egyeztetés és indokolt megállapodás szükséges."] };
        return calculation;
    }
    private async Task<SettlementCalculation> CalculateSettlement(SettlementDraft draft, string user, DateOnly month, CancellationToken ct)
    {
        var metadata = await db.FuelSettlementVehicles.Where(x => x.UserId == user && x.Month == month && x.SourceMetadata != null)
            .Select(x => x.SourceMetadata!).ToArrayAsync(ct);
        return CompareSources(draft, FuelSettlementCalculator.Calculate(draft), metadata.Select(Unpack<SettlementSource>));
    }
    public Task<SettlementView> ImportSettlement(LegacyFuelSettlementReader.Item item, string user, Guid vehicleId, string reason, CancellationToken ct) =>
        Scoped(Permissions.SettlementsManage, async access => {
            var month = item.Row.Month;
            await SettlementMonth(user, month, ct);
            if (await SettlementEntity(user, month, ct) is not null) throw Error(409, "settlement_exists", "Erre a személyre és hónapra már van elszámolás. A meglévőt javítsd.");
            var car = await Car(vehicleId, access, Permissions.SettlementsManage, ct, write: true);
            reason = FleetValidation.Text(reason, 500, "Importálás indoka", required: true)!;
            var registration = NormalizeRegistration(item.Row.Registration);
            if (car.Registration != registration && !await db.VehicleRegistrations.AnyAsync(x => x.VehicleId == vehicleId && x.Registration == registration, ct))
                throw FleetValidation.Invalid("Az Excel rendszáma nem egyezik a jármű jelenlegi vagy korábbi rendszámával. Előbb rendezd az azonosítást.");
            var row = item.Row;
            // Cached Excel values can contain harmless binary tails; retain three decimal places for quantities.
            decimal? Quantity(decimal? value) => value is null ? null : decimal.Round(value.Value, 3);
            var draft = new SettlementDraft(0, row.Rules, [new(vehicleId, Quantity(row.StartKm), Quantity(row.EndKm), Quantity(row.Liters), Quantity(row.PrivateKm), row.UnitPrice)], Reason: reason);
            draft = await PrepareSettlement(user, month, draft, null, access, Permissions.SettlementsManage, ct);
            var source = new SettlementSource(vehicleId, row.FileName, row.Sheet, row.OriginalAmount, row.Formula, Convert.ToHexString(SHA256.HashData(item.Workbook)));
            db.FuelSettlementVehicles.Add(new() { TenantId = TenantId, UserId = user, Month = month, VehicleId = vehicleId,
                SourceWorkbook = item.Workbook, SourceMetadata = Pack(source) });
            return await PersistSettlement(user, month, null, draft, CompareSources(draft, FuelSettlementCalculator.Calculate(draft), [source]), "Draft", reason, ct);
        }, ct);

    public Task<byte[]> SettlementSourceFile(string? userId, DateOnly month, Guid vehicle, CancellationToken ct)
    {
        // A full annual workbook can include other drivers' private data. Only a scoped manager may download it.
        var user = userId ?? Actor; var permission = Permissions.SettlementsManage;
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct);
            await Car(vehicle, access, permission, ct);
            var source = await db.FuelSettlementVehicles.SingleOrDefaultAsync(x => x.UserId == user && x.Month == month && x.VehicleId == vehicle, ct);
            return source?.SourceWorkbook ?? throw Error(404, "settlement_source", "Nincs eredeti Excel-forrás.");
        }, ct);
    }
}
