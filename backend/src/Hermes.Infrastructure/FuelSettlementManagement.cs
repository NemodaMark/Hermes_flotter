using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    private static readonly JsonSerializerOptions SettlementJson = new(JsonSerializerDefaults.Web);
    private static string Pack<T>(T value) => JsonSerializer.Serialize(value, SettlementJson);
    private static T Unpack<T>(string value) => JsonSerializer.Deserialize<T>(value, SettlementJson)!;
    private string SettlementPermission(string user, bool write = false)
    {
        if (context.Permissions.Contains(Permissions.SettlementsManage)) return Permissions.SettlementsManage;
        if (!write && context.Permissions.Contains(Permissions.SettlementsApprove)) return Permissions.SettlementsApprove;
        if (user != Actor) throw Error(403, "settlement_forbidden", "Más felhasználó elszámolásához kezelési jog szükséges.");
        return write || !context.Permissions.Contains(Permissions.SettlementsRead) ? Permissions.SettlementsRecord : Permissions.SettlementsRead;
    }
    private async Task SettlementMonth(string user, DateOnly month, CancellationToken ct)
    {
        MileageLedger.ValidateMonth(month, await CompanyToday(ct));
        await CheckMileageUser(user, ct);
    }
    private async Task<FuelSettlement?> SettlementEntity(string user, DateOnly month, CancellationToken ct) =>
        await db.FuelSettlements.SingleOrDefaultAsync(x => x.UserId == user && x.Month == month, ct);
    private async Task<SettlementPolicy> Policy(DateOnly month, CancellationToken ct)
    {
        var policy = await db.FuelSettlementPolicies.AsNoTracking().Where(x => x.Month <= month).OrderByDescending(x => x.Month).FirstOrDefaultAsync(ct);
        return new(policy?.Month ?? month, policy?.Version ?? 0, policy is null ? new() : Unpack<SettlementRules>(policy.Rules));
    }
    private async Task<SettlementView> SettlementRow(string user, DateOnly month, FuelSettlement? entity, CancellationToken ct)
    {
        if (entity is null)
        {
            var draft = new SettlementDraft(0, (await Policy(month, ct)).Rules, []);
            return new(user, month, 0, "Draft", draft, FuelSettlementCalculator.Calculate(draft), [], null, null, null, null);
        }
        var refs = await db.FuelSettlementVehicles.AsNoTracking().Where(x => x.UserId == user && x.Month == month && x.SourceMetadata != null)
            .Select(x => x.SourceMetadata!).ToArrayAsync(ct);
        var data = Unpack<SettlementDraft>(entity.Data);
        var ids = data.Lines.Select(x => x.VehicleId).ToArray();
        return new(user, month, entity.Version, entity.Status, data with { Version = entity.Version },
            Unpack<SettlementCalculation>(entity.Calculation), refs.Select(Unpack<SettlementSource>).ToArray(),
            entity.UpdatedBy, entity.UpdatedAt, entity.ApprovedBy, entity.ApprovedAt) {
                Vehicles = await db.Vehicles.Where(x => ids.Contains(x.Id)).Select(x => new SettlementVehicle(x.Id, x.Registration, x.OdometerKm)).ToArrayAsync(ct) };
    }
    private async Task CheckSettlementCars(IEnumerable<Guid> ids, ResourceAccess access, string permission, CancellationToken ct, bool write = false)
    {
        foreach (var id in ids.Distinct()) await Car(id, access, permission, ct, write);
    }
    private async Task CheckExistingSettlement(FuelSettlement? entity, ResourceAccess access, string permission, CancellationToken ct, bool write = false)
    {
        if (entity is not null) await CheckSettlementCars(Unpack<SettlementDraft>(entity.Data).Lines.Select(x => x.VehicleId), access, permission, ct, write);
    }
    private string[] SettlementReadPermissions(string user) => new[] { Permissions.SettlementsManage, Permissions.SettlementsApprove }
        .Concat(user == Actor ? new[] { Permissions.SettlementsRead, Permissions.SettlementsRecord } : Array.Empty<string>())
        .Where(context.Permissions.Contains).ToArray();
    private async Task<Guid[]> SettlementReadableVehicles(string user, ResourceAccess access, CancellationToken ct)
    {
        var ids = new HashSet<Guid>();
        foreach (var code in SettlementReadPermissions(user)) ids.UnionWith(await VehicleAccess.Query(db, access, code).Select(x => x.Id).ToArrayAsync(ct));
        return ids.ToArray();
    }
    private async Task CheckSettlementRead(IEnumerable<Guid> ids, string user, ResourceAccess access, CancellationToken ct)
    {
        var visible = (await SettlementReadableVehicles(user, access, ct)).ToHashSet();
        if (ids.Any(x => !visible.Contains(x))) throw Error(404, "settlement_vehicle", "Az elszámolás egy vagy több járműve nem érhető el.");
    }
    public Task<SettlementView> ReadSettlement(string? userId, DateOnly month, CancellationToken ct)
    {
        var user = userId ?? Actor; var permission = SettlementPermission(user);
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct); var entity = await SettlementEntity(user, month, ct);
            if (entity is not null) await CheckSettlementRead(Unpack<SettlementDraft>(entity.Data).Lines.Select(x => x.VehicleId), user, access, ct);
            if (entity?.Status == "Approved")
            {
                var snapshot = await db.FuelSettlementHistory.AsNoTracking().Where(x => x.UserId == user && x.Month == month && x.Version == entity.Version)
                    .Select(x => x.Snapshot).SingleAsync(ct);
                return Unpack<SettlementView>(snapshot);
            }
            return await SettlementRow(user, month, entity, ct);
        }, ct);
    }
    public Task<SettlementOptions> SettlementOptions(string? userId, DateOnly month, CancellationToken ct)
    {
        var user = userId ?? Actor; var permission = SettlementPermission(user);
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct);
            var canOthers = permission is Permissions.SettlementsManage or Permissions.SettlementsApprove;
            var people = await (from member in db.Memberships.AsNoTracking() join account in db.Users on member.UserSubject equals account.Id
                where member.TenantId == TenantId && (canOthers || account.Id == Actor)
                orderby account.DisplayName, account.Id select new SettlementPerson(account.Id, account.DisplayName ?? account.Id)).ToArrayAsync(ct);
            var visible = await SettlementReadableVehicles(user, access, ct);
            var cars = db.Vehicles.Where(x => visible.Contains(x.Id) && x.Status != Domain.VehicleStatus.Archived);
            if (!canOthers)
            {
                var begin = new DateTimeOffset(month.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
                var end = begin.AddMonths(1);
                cars = cars.Where(x => db.VehicleUserAssignments.Any(a => a.VehicleId == x.Id && a.UserId == user && a.AssignedAt < end && (a.ReleasedAt == null || a.ReleasedAt > begin)));
            }
            return new SettlementOptions(people, await cars.OrderBy(x => x.Registration).Select(x => new SettlementVehicle(x.Id, x.Registration, x.OdometerKm)).ToArrayAsync(ct), await Policy(month, ct));
        }, ct);
    }
    private static void SettlementNumber(decimal? value, string label, decimal max = 100_000_000, int scale = 3)
    {
        if (value is { } n && (n < 0 || n > max || decimal.Round(n, scale) != n)) throw FleetValidation.Invalid($"{label}: 0 és {max} közötti, legfeljebb {scale} tizedesjegyű értéket adj meg.");
    }
    private static void ValidateRules(SettlementRules rules)
    {
        SettlementNumber(rules.FreeKm, "Ingyenes magánkeret"); SettlementNumber(rules.FirstBandKm, "Első díjsáv");
        SettlementNumber(rules.FirstRate, "Első díj", 1_000_000, 4); SettlementNumber(rules.SecondRate, "Második díj", 1_000_000, 4);
    }
    private async Task<SettlementDraft> PrepareSettlement(string user, DateOnly month, SettlementDraft input, FuelSettlement? current,
        ResourceAccess access, string permission, CancellationToken ct)
    {
        if (input.Rules is null || input.Lines is null || input.Lines.Length is < 1 or > 20 || input.Lines.Any(x => x is null) || input.Lines.Select(x => x.VehicleId).Distinct().Count() != input.Lines.Length)
            throw FleetValidation.Invalid("1–20 különböző járművet adj meg, elszámolási szabályokkal.");
        ValidateRules(input.Rules); SettlementNumber(input.AgreedAmount, "Egyedi összeg", 999_999_999_999.99m, 2);
        var manage = permission == Permissions.SettlementsManage;
        var expectedRules = current is null ? (await Policy(month, ct)).Rules : Unpack<SettlementDraft>(current.Data).Rules;
        if (!manage && (input.Rules != expectedRules || input.AgreedAmount != (current is null ? null : Unpack<SettlementDraft>(current.Data).AgreedAmount)
            || input.AgreementReason != (current is null ? null : Unpack<SettlementDraft>(current.Data).AgreementReason)))
            throw Error(403, "settlement_rules", "Keretet, díjat vagy egyedi megállapodást csak elszámoláskezelő módosíthat.");
        var agreement = FleetValidation.Text(input.AgreementReason, 500, "Egyedi megállapodás indoka", required: input.AgreedAmount is not null);
        var lines = new List<SettlementLineInput>();
        foreach (var row in input.Lines)
        {
            await Car(row.VehicleId, access, permission, ct, write: true);
            if (!manage)
            {
                var begin = new DateTimeOffset(month.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); var end = begin.AddMonths(1);
                if (!await db.VehicleUserAssignments.AnyAsync(x => x.VehicleId == row.VehicleId && x.UserId == user && x.AssignedAt < end && (x.ReleasedAt == null || x.ReleasedAt > begin), ct))
                    throw Error(403, "settlement_assignment", "Csak az adott hónapban hozzád rendelt autót számolhatod el.");
            }
            SettlementNumber(row.StartKm, "Nyitó km"); SettlementNumber(row.EndKm, "Záró km"); SettlementNumber(row.PrivateKm, "Magán km");
            SettlementNumber(row.Liters, "Liter", 1_000_000); SettlementNumber(row.UnitPrice, "Üzemanyagár", 1_000_000, 4);
            var liters = row.Liters;
            if (row.UseRecordedFuel)
            {
                var values = await db.VehicleFuelEntries.Where(x => x.VehicleId == row.VehicleId && x.VoidedAt == null && x.FueledOn >= month && x.FueledOn < month.AddMonths(1))
                    .Select(x => x.Liters).ToArrayAsync(ct);
                liters = values.Length == 0 ? null : values.Sum();
            }
            lines.Add(row with { Liters = liters, UseRecordedFuel = false, PriceSource = FleetValidation.Text(row.PriceSource, 200, "Üzemanyagár forrása") });
        }
        return input with { Lines = lines.ToArray(), AgreementReason = agreement, Reason = FleetValidation.Text(input.Reason, 500, "Módosítás indoka") };
    }
    public Task<SettlementCalculation> PreviewSettlement(string? userId, DateOnly month, SettlementDraft input, CancellationToken ct)
    {
        var user = userId ?? Actor; var permission = SettlementPermission(user, true);
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct); var current = await SettlementEntity(user, month, ct);
            await CheckExistingSettlement(current, access, permission, ct, true);
            var prepared = await PrepareSettlement(user, month, input, current, access, permission, ct);
            return await CalculateSettlement(prepared, user, month, ct);
        }, ct);
    }
    private async Task<SettlementView> PersistSettlement(string user, DateOnly month, FuelSettlement? entity, SettlementDraft input,
        SettlementCalculation calculation, string status, string? reason, CancellationToken ct)
    {
        if (entity is null)
        {
            entity = new() { TenantId = TenantId, UserId = user, Month = month, Data = "{}", Calculation = "{}", UpdatedBy = Actor };
            db.FuelSettlements.Add(entity);
        }
        else entity.Version++;
        entity.Status = status; entity.Data = Pack(input); entity.Calculation = Pack(calculation); entity.UpdatedAt = DateTimeOffset.UtcNow; entity.UpdatedBy = Actor;
        entity.ApprovedAt = status == "Approved" ? DateTimeOffset.UtcNow : null; entity.ApprovedBy = status == "Approved" ? Actor : null;
        await db.SaveChangesAsync(ct);
        var result = await SettlementRow(user, month, entity, ct);
        db.FuelSettlementHistory.Add(new() { TenantId = TenantId, UserId = user, Month = month, Version = entity.Version,
            Status = status, Actor = Actor, Snapshot = Pack(result), Reason = reason });
        foreach (var line in input.Lines)
            Audit("vehicle.settlement_" + status.ToLowerInvariant(), line.VehicleId, null,
                new { user, month, entity.Version, status, reason, line, result = calculation.Lines.Single(x => x.VehicleId == line.VehicleId) }, line.VehicleId);
        await db.SaveChangesAsync(ct);
        return result;
    }
    public Task<SettlementView> SaveSettlement(string? userId, DateOnly month, SettlementDraft input, CancellationToken ct)
    {
        var user = userId ?? Actor; var permission = SettlementPermission(user, true);
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct); var current = await SettlementEntity(user, month, ct);
            await CheckExistingSettlement(current, access, permission, ct, true);
            if (input.Version != (current?.Version ?? 0)) throw Error(409, "settlement_version", "Az elszámolás megváltozott. Frissítsd az adatokat.");
            if (current?.Status is "Submitted" or "Approved") throw Error(409, "settlement_locked", "Előbb indoklással nyisd újra az elszámolást.");
            var reason = FleetValidation.Text(input.Reason, 500, "Módosítás indoka", required: current is not null);
            var prepared = await PrepareSettlement(user, month, input, current, access, permission, ct);
            var refs = await db.FuelSettlementVehicles.Where(x => x.UserId == user && x.Month == month).ToArrayAsync(ct);
            foreach (var item in refs.Where(x => prepared.Lines.All(l => l.VehicleId != x.VehicleId)))
            {
                if (item.SourceWorkbook is not null) throw Error(409, "settlement_source", "Az importált forrás nem törölhető; a meglévő sort javítsd.");
                db.FuelSettlementVehicles.Remove(item);
            }
            // New references are saved after their parent, within this same tenant transaction.
            var result = await PersistSettlement(user, month, current, prepared, await CalculateSettlement(prepared, user, month, ct), "Draft", reason, ct);
            foreach (var row in prepared.Lines.Where(x => refs.All(r => r.VehicleId != x.VehicleId)))
                db.FuelSettlementVehicles.Add(new() { TenantId = TenantId, UserId = user, Month = month, VehicleId = row.VehicleId });
            await db.SaveChangesAsync(ct);
            return result;
        }, ct);
    }
    public Task<SettlementView> ChangeSettlement(string? userId, DateOnly month, string action, SettlementAction input, CancellationToken ct)
    {
        var user = userId ?? Actor;
        var permission = action == "approve" ? Permissions.SettlementsApprove : action == "reopen" ? Permissions.SettlementsManage : SettlementPermission(user, true);
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct); var entity = await SettlementEntity(user, month, ct) ?? throw Error(404, "settlement_missing", "Az elszámolás nem található.");
            await CheckExistingSettlement(entity, access, permission, ct, true);
            if (input.Version != entity.Version) throw Error(409, "settlement_version", "Az elszámolás megváltozott.");
            var draft = Unpack<SettlementDraft>(entity.Data); var calculation = Unpack<SettlementCalculation>(entity.Calculation);
            var reason = FleetValidation.Text(input.Reason, 500, "Állapotváltás indoka", required: action == "reopen");
            var status = action switch { "submit" when entity.Status == "Draft" => "Submitted", "approve" when entity.Status == "Submitted" => "Approved",
                "reopen" when entity.Status != "Draft" => "Draft", _ => throw Error(409, "settlement_state", "Ez az állapotváltás nem végezhető el.") };
            if (action != "reopen")
            {
                if (month >= MileageLedger.MonthOf(await CompanyToday(ct))) throw Error(409, "settlement_month_open", "Csak lezárult hónapot küldhetsz be.");
                if (calculation.Issues.Length > 0 || calculation.Amount is null) throw Error(409, "settlement_incomplete", "Előbb pótold vagy javítsd a hiányzó adatokat.");
            }
            return await PersistSettlement(user, month, entity, draft, calculation, status, reason, ct);
        }, ct);
    }
    public Task<SettlementRevision[]> SettlementHistory(string? userId, DateOnly month, CancellationToken ct)
    {
        var user = userId ?? Actor; var permission = SettlementPermission(user);
        return Scoped(permission, async access => {
            await SettlementMonth(user, month, ct);
            var revisions = await db.FuelSettlementHistory.AsNoTracking().Where(x => x.UserId == user && x.Month == month).OrderByDescending(x => x.Version).ToArrayAsync(ct);
            var result = new List<SettlementRevision>();
            foreach (var item in revisions)
            {
                var report = Unpack<SettlementView>(item.Snapshot);
                await CheckSettlementRead(report.Data.Lines.Select(x => x.VehicleId), user, access, ct);
                result.Add(new(item.Version, item.Status, item.Actor, item.CreatedAt, item.Reason, report));
            }
            return result.ToArray();
        }, ct);
    }
    public Task<SettlementPolicy> SaveSettlementPolicy(DateOnly month, SettlementPolicyInput input, CancellationToken ct) => Scoped(Permissions.SettlementsConfigure, async _ => {
        if (month.Day != 1 || month.Year is < 1900 or > 2100 || input.Rules is null) throw FleetValidation.Invalid("Érvényes kezdőhónapot és szabályokat adj meg.");
        ValidateRules(input.Rules);
        var row = await db.FuelSettlementPolicies.SingleOrDefaultAsync(x => x.Month == month, ct);
        if (input.Version != (row?.Version ?? 0)) throw Error(409, "settlement_policy_version", "A szabály időközben megváltozott.");
        var before = row?.Rules;
        if (row is null) { row = new() { TenantId = TenantId, Month = month, Rules = Pack(input.Rules) }; db.FuelSettlementPolicies.Add(row); }
        else { row.Rules = Pack(input.Rules); row.Version++; }
        Audit("settlement.policy_changed", Guid.Empty, before, new { month, row.Rules, row.Version }); await db.SaveChangesAsync(ct);
        return new SettlementPolicy(month, row.Version, input.Rules);
    }, ct);
}
