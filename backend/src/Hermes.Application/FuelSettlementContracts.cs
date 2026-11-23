namespace Hermes.Application;

public sealed record SettlementRules(decimal FreeKm = 350, decimal FirstBandKm = 500, decimal FirstRate = 30, decimal SecondRate = 50);
public sealed record SettlementLineInput(Guid VehicleId, decimal? StartKm, decimal? EndKm, decimal? Liters,
    decimal? PrivateKm, decimal? UnitPrice, bool UseRecordedFuel = false, string? PriceSource = null);
public sealed record SettlementDraft(long Version, SettlementRules Rules, SettlementLineInput[] Lines,
    decimal? AgreedAmount = null, string? AgreementReason = null, string? Reason = null);
public sealed record SettlementLineResult(Guid VehicleId, decimal? TotalKm, decimal? Consumption, decimal? FreeKm,
    decimal? PaidKm, decimal? FirstBandKm, decimal? SecondBandKm, decimal? FuelAmount, decimal? FirstAmount,
    decimal? SecondAmount, decimal? Amount);
public sealed record SettlementCalculation(SettlementLineResult[] Lines, decimal? StandardAmount, decimal? Amount, string[] Issues);
public sealed record SettlementSource(Guid VehicleId, string FileName, string Sheet, decimal? OriginalAmount, string? Formula, string Sha256);
public sealed record SettlementView(string UserId, DateOnly Month, long Version, string Status, SettlementDraft Data,
    SettlementCalculation Calculation, SettlementSource[] Sources, string? UpdatedBy, DateTimeOffset? UpdatedAt,
    string? ApprovedBy, DateTimeOffset? ApprovedAt)
{
    public SettlementVehicle[] Vehicles { get; init; } = [];
}
public sealed record SettlementPolicyInput(long Version, SettlementRules Rules);
public sealed record SettlementPolicy(DateOnly Month, long Version, SettlementRules Rules);
public sealed record SettlementAction(long Version, string? Reason = null);
public sealed record SettlementPerson(string Id, string Name);
public sealed record SettlementVehicle(Guid Id, string Registration, decimal? OdometerKm);
public sealed record SettlementOptions(SettlementPerson[] People, SettlementVehicle[] Vehicles, SettlementPolicy Policy);
public sealed record SettlementRevision(long Version, string Status, string Actor, DateTimeOffset CreatedAt, string? Reason, SettlementView Report);
public sealed record LegacySettlementRow(string Id, string FileName, string Sheet, DateOnly Month, string Registration,
    string? Employee, decimal? StartKm, decimal? EndKm, decimal? Liters, decimal? PrivateKm, decimal? UnitPrice,
    SettlementRules Rules, decimal? OriginalAmount, string? Formula, string[] Warnings);

// Decimal arithmetic preserves fractional private kilometres and avoids rounding consumption before pricing.
public static class FuelSettlementCalculator
{
    public static SettlementCalculation Calculate(SettlementDraft draft)
    {
        var issues = new List<string>();
        var rows = draft.Lines;
        if (rows.Length == 0) issues.Add("Adj meg legalább egy járművet.");
        foreach (var row in rows)
        {
            if (row.StartKm is null || row.EndKm is null) issues.Add("Hiányzik a nyitó vagy záró kilométerállás.");
            else if (row.EndKm < row.StartKm) issues.Add("A záró kilométerállás kisebb a nyitónál.");
            if (row.PrivateKm is null) issues.Add("Hiányzik a magánkilométer. A nulla használatot is add meg.");
            else if (row.StartKm is { } start && row.EndKm is { } end && row.PrivateKm > end - start)
                issues.Add("A magánkilométer nagyobb a teljes havi futásnál.");
        }
        var invalid = issues.Count > 0;
        var totalPrivate = rows.Sum(x => x.PrivateKm ?? 0);
        var free = Math.Min(draft.Rules.FreeKm, totalPrivate);
        var paid = Math.Max(0, totalPrivate - free);
        var band = Math.Min(paid, draft.Rules.FirstBandKm);
        decimal freeLeft = free, bandLeft = band;
        var result = new List<SettlementLineResult>();
        // A single personal allowance and first band are allocated proportionally across cars.
        var ordered = rows.OrderBy(x => x.VehicleId).ToArray();
        for (var i = 0; i < ordered.Length; i++)
        {
            var row = ordered[i]; var distance = row.EndKm - row.StartKm;
            decimal? consumption = distance > 0 && row.Liters is { } liters ? 100 * liters / distance : null;
            if (invalid)
            {
                result.Add(new(row.VehicleId, distance, consumption, null, null, null, null, null, null, null, null));
                continue;
            }
            var allocatedFree = i == ordered.Length - 1 ? freeLeft : totalPrivate > 0 ? free * row.PrivateKm!.Value / totalPrivate : 0;
            freeLeft -= allocatedFree;
            var charged = Math.Max(0, row.PrivateKm!.Value - allocatedFree);
            var first = i == ordered.Length - 1 ? bandLeft : paid > 0 ? band * charged / paid : 0;
            bandLeft -= first;
            var second = Math.Max(0, charged - first);
            decimal? fuel = charged == 0 ? 0 : consumption is { } c && row.UnitPrice is { } price ? charged * c / 100 * price : null;
            if (charged > 0 && row.UnitPrice is null) issues.Add("Hiányzik az üzemanyagár a fizetős magánhasználathoz.");
            if (charged > 0 && consumption is null) issues.Add("Hiányzik a fogyasztáshoz szükséges liter vagy havi futás.");
            var firstAmount = first * draft.Rules.FirstRate; var secondAmount = second * draft.Rules.SecondRate;
            decimal? amount = fuel is null ? null : Math.Round(fuel.Value + firstAmount + secondAmount, 2, MidpointRounding.AwayFromZero);
            result.Add(new(row.VehicleId, distance, consumption, allocatedFree, charged, first, second, fuel, firstAmount, secondAmount, amount));
        }
        decimal? standard = issues.Count > 0 ? null : result.Sum(x => x.Amount!.Value);
        return new(result.ToArray(), standard, standard is null ? null : draft.AgreedAmount ?? standard, issues.Distinct().ToArray());
    }
}
