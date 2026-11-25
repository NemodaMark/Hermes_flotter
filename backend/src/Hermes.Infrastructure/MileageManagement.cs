using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

internal static class MileageLedger
{
    internal static DateOnly MonthOf(DateOnly date) => new(date.Year, date.Month, 1);
    internal static void ValidateMonth(DateOnly month, DateOnly today)
    {
        FleetValidation.Date(month);
        if (month.Day != 1 || month > MonthOf(today)) throw FleetValidation.Invalid("Már megkezdett naptári hónapot válassz.");
    }
    internal static void Numbers(long total, long personal)
    {
        if (total is < 0 or > 100_000_000 || personal < 0 || personal > total)
            throw FleetValidation.Invalid("A magánkilométer 0 és a teljes megtett távolság közé essen.");
    }
    internal static async Task<DateOnly?> Due(HermesDbContext db, string user, DateOnly today, CancellationToken ct)
    {
        var account = await db.MileageAccounts.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == user, ct);
        if (account is null) return null;
        var current = MonthOf(today);
        var submitted = (await db.MileageMonths.AsNoTracking().Where(x => x.UserId == user && x.SubmittedAt != null && x.Month < current)
            .Select(x => x.Month).ToArrayAsync(ct)).ToHashSet();
        for (var month = account.FirstMonth; month < current; month = month.AddMonths(1)) if (!submitted.Contains(month)) return month;
        return null;
    }
    internal static async Task<MileageAccount> Account(HermesDbContext db, Guid tenant, string user, DateOnly month, CancellationToken ct)
    {
        var account = db.MileageAccounts.Local.FirstOrDefault(x => x.TenantId == tenant && x.UserId == user)
            ?? await db.MileageAccounts.SingleOrDefaultAsync(x => x.UserId == user, ct);
        if (account is not null)
        {
            if (month < account.FirstMonth) { account.FirstMonth = month; account.Version++; }
            return account;
        }
        var member = await db.Memberships.AsNoTracking().WithAccess().SingleOrDefaultAsync(x => x.TenantId == tenant && x.UserSubject == user && x.IsActive, ct);
        if (member?.HasCompanyAccess != true) throw UserAccounts.Error(404, "mileage_user", "Aktív céges felhasználót válassz.");
        account = new() { TenantId = tenant, UserId = user, FirstMonth = month };
        db.MileageAccounts.Add(account);
        return account;
    }
    internal static async Task<MileageMonth> Writable(HermesDbContext db, Guid tenant, string user, string actor, DateOnly month, long? version, CancellationToken ct)
    {
        var account = await Account(db, tenant, user, month, ct);
        var report = db.MileageMonths.Local.FirstOrDefault(x => x.UserId == user && x.Month == month)
            ?? await db.MileageMonths.SingleOrDefaultAsync(x => x.UserId == user && x.Month == month, ct);
        if (version is not null && version != (report?.Version ?? 0))
            throw UserAccounts.Error(409, "mileage_conflict", "Az elszámolás időközben megváltozott. Frissítsd az adatokat.");
        if (report is not null) return report;
        report = new() { TenantId = tenant, UserId = user, Month = month, Mode = account.Mode, UpdatedBy = actor };
        db.MileageMonths.Add(report);
        return report;
    }
    internal static void Touch(MileageMonth report, string actor)
    {
        report.Version++;
        report.UpdatedBy = actor;
        report.UpdatedAt = DateTimeOffset.UtcNow;
    }
    internal static MileageEntryRow Row(MileageEntry e) => new(e.Id, e.OccurredOn, e.TotalKm, e.PrivateKm, e.Source, e.Version,
        e.VoidedAt is not null, e.RecordedBy, e.RecordedAt, e.UpdatedBy, e.UpdatedAt);

    internal static async Task CheckInterval(HermesDbContext db, Guid vehicle, long end, long distance, Guid? except, CancellationToken ct)
    {
        if (distance > end) throw FleetValidation.Invalid("A megtett távolság nagyobb a megadott kilométerállásnál.");
        if (await HasOverlap(db, vehicle, end, distance, except, ct))
            throw UserAccounts.Error(409, "mileage_overlap", "Ezt a kilométerszakaszt már elszámoltad. A havi elszámolásban javítsd a meglévő tételt.");
    }

    internal static async Task<bool> HasOverlap(HermesDbContext db, Guid vehicle, long end, long distance, Guid? except, CancellationToken ct)
        => distance > 0 && await db.MileageEntries.AnyAsync(x => x.VehicleId == vehicle && x.Id != except && x.VoidedAt == null
            && x.StartKilometers < end && x.EndKilometers > end - distance, ct);

    internal static Task AuthorizeCapture(HermesDbContext db, ITenantContext context, CancellationToken ct)
        => AccessRules.Authorize(db, context.TenantId!.Value, context.UserSubject!,
            context.Permissions.Contains(Permissions.MileageManage) ? Permissions.MileageManage : Permissions.MileageRecord, ct);

    // Caller already holds the company transaction and lock; capture and the source operation commit together.
    internal static async Task Capture(HermesDbContext db, ITenantContext context, Guid vehicle, string source, Guid sourceId,
        DateOnly occurredOn, long endKilometers, MileageUsageInput? input, CancellationToken ct)
    {
        if (input is null) return;
        var tenant = context.TenantId!.Value;
        var actor = context.UserSubject!;
        await AuthorizeCapture(db, context, ct);
        Numbers(input.TotalKm, input.PrivateKm);
        await CheckInterval(db, vehicle, endKilometers, input.TotalKm, null, ct);
        if (input.Month != MonthOf(occurredOn)) throw FleetValidation.Invalid("Az elszámolási tétel a rögzítés naptári hónapjához tartozzon. A hónaphatárt külön havi tételekkel számold el.");
        var report = await Writable(db, tenant, actor, actor, input.Month, null, ct);
        if (report.Mode != "Entries" || report.SubmittedAt is not null)
            throw UserAccounts.Error(409, "mileage_mode", "Ehhez a hónaphoz havi összesítő tartozik, vagy már lezártad. A havi elszámolásban folytasd.");
        Numbers(report.TotalKm + input.TotalKm, report.PrivateKm + input.PrivateKm);
        var entry = new MileageEntry { TenantId = tenant, UserId = actor, Month = input.Month, VehicleId = vehicle,
            OccurredOn = occurredOn, TotalKm = input.TotalKm, PrivateKm = input.PrivateKm, StartKilometers = endKilometers - input.TotalKm,
            EndKilometers = endKilometers, Source = source, SourceId = sourceId, RecordedBy = actor };
        db.MileageEntries.Add(entry);
        report.TotalKm += input.TotalKm;
        report.PrivateKm += input.PrivateKm;
        Touch(report, actor);
        var details = System.Text.Json.JsonSerializer.Serialize(new { userId = actor, input.Month, entry = Row(entry) });
        db.AccessAuditEvents.Add(new() { TenantId = tenant, ActorSubject = actor, TargetSubject = actor, Action = "mileage.entry_created", Details = details });
        UserAccounts.Audit(db, actor, actor, "mileage.entry_created", new { input.Month, entry = Row(entry) }, tenant);
    }
}

public sealed partial class FleetManagement
{
    private string MileagePermission(string user) => user != Actor || context.Permissions.Contains(Permissions.MileageManage)
        ? Permissions.MileageManage : Permissions.MileageRecord;
    private async Task CheckMileageUser(string user, CancellationToken ct)
    {
        if (!await db.Memberships.AnyAsync(x => x.TenantId == TenantId && x.UserSubject == user, ct)) throw Error(404, "mileage_user", "A céges felhasználó nem található.");
    }
    private async Task<MileageReport> MileageReport(string user, DateOnly month, CancellationToken ct, DateOnly? today = null)
    {
        var account = await db.MileageAccounts.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == user, ct);
        var report = await db.MileageMonths.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == user && x.Month == month, ct);
        var entries = await db.MileageEntries.AsNoTracking().Where(x => x.UserId == user && x.Month == month)
            .OrderByDescending(x => x.OccurredOn).ThenByDescending(x => x.RecordedAt)
            .Select(x => new MileageEntryRow(x.Id, x.OccurredOn, x.TotalKm, x.PrivateKm, x.Source, x.Version, x.VoidedAt != null,
                x.RecordedBy, x.RecordedAt, x.UpdatedBy, x.UpdatedAt)).ToArrayAsync(ct);
        return new(user, month, report?.Mode ?? account?.Mode ?? "Entries", report?.TotalKm ?? 0, report?.PrivateKm ?? 0,
            report?.LimitCaptured == true ? report.LimitKm : account?.MonthlyLimitKm, report?.Version ?? 0,
            report?.SubmittedAt, report?.UpdatedBy, report?.UpdatedAt, await MileageLedger.Due(db, user, today ?? await CompanyToday(ct), ct), entries);
    }
    public Task<MileageReport> ReadMileage(string? userId, DateOnly? month, CancellationToken ct)
    {
        var user = userId ?? Actor;
        return Scoped(MileagePermission(user), async _ =>
        {
            await CheckMileageUser(user, ct);
            var today = await CompanyToday(ct);
            var requested = month ?? MileageLedger.MonthOf(today);
            MileageLedger.ValidateMonth(requested, today);
            return await MileageReport(user, requested, ct, today);
        }, ct);
    }
    public Task<MileageUser[]> MileageUsers(CancellationToken ct) => Scoped(Permissions.MileageManage, async _ =>
    {
        return await (from member in db.Memberships.AsNoTracking() join user in db.Users on member.UserSubject equals user.Id
            join account in db.MileageAccounts.AsNoTracking() on member.UserSubject equals account.UserId into accounts
            from account in accounts.DefaultIfEmpty()
            where member.TenantId == TenantId && (member.IsActive || account != null)
            orderby user.DisplayName, user.Id
            select new MileageUser(user.Id, user.DisplayName ?? user.Id, account == null ? null : account.MonthlyLimitKm, account == null ? 0 : account.Version)).ToArrayAsync(ct);
    }, ct);
    public Task<MileageUser> SetMileageLimit(string user, MileageAccountInput input, CancellationToken ct) => Scoped(Permissions.MileageManage, async _ =>
    {
        await CheckMileageUser(user, ct);
        if (input.MonthlyLimitKm is < 0 or > 100_000_000) throw FleetValidation.Invalid("Érvényes havi km-keretet adj meg.");
        var existing = await db.MileageAccounts.SingleOrDefaultAsync(x => x.UserId == user, ct);
        if (input.Version != (existing?.Version ?? 0)) throw Error(409, "mileage_conflict", "A km-keret időközben megváltozott.");
        var account = existing ?? await MileageLedger.Account(db, TenantId, user, MileageLedger.MonthOf(await CompanyToday(ct)), ct);
        var before = account.MonthlyLimitKm;
        account.MonthlyLimitKm = input.MonthlyLimitKm;
        account.Version++;
        Audit("mileage.limit_changed", Guid.Empty, new { user, monthlyLimitKm = before }, new { user, account.MonthlyLimitKm, account.Version });
        await db.SaveChangesAsync(ct);
        var name = await db.Users.Where(x => x.Id == user).Select(x => x.DisplayName).SingleAsync(ct);
        return new MileageUser(user, name ?? user, account.MonthlyLimitKm, account.Version);
    }, ct);
    public Task<MileageReport> SetMileageMode(string? userId, DateOnly month, MileageModeInput input, CancellationToken ct)
    {
        var user = userId ?? Actor;
        return Scoped(MileagePermission(user), async _ =>
        {
            await CheckMileageUser(user, ct);
            MileageLedger.ValidateMonth(month, await CompanyToday(ct));
            if (input.Mode is not ("Entries" or "Monthly")) throw FleetValidation.Invalid("Tételes vagy havi összesítő módot válassz.");
            var report = await MileageLedger.Writable(db, TenantId, user, Actor, month, input.Version, ct);
            if (report.SubmittedAt is not null) throw Error(409, "mileage_submitted", "A lezárt hónap adatait indoklással, javításként módosíthatod.");
            var before = report.Mode;
            if (before != input.Mode && input.Mode == "Entries")
            {
                var rows = await db.MileageEntries.Where(x => x.UserId == user && x.Month == month && x.VoidedAt == null).ToArrayAsync(ct);
                report.TotalKm = rows.Sum(x => x.TotalKm);
                report.PrivateKm = rows.Sum(x => x.PrivateKm);
            }
            report.Mode = input.Mode;
            var account = await MileageLedger.Account(db, TenantId, user, month, ct);
            account.Mode = input.Mode;
            account.Version++;
            MileageLedger.Touch(report, Actor);
            Audit("mileage.mode_changed", Guid.Empty, new { user, month, Mode = before }, new { user, month, report.Mode });
            await db.SaveChangesAsync(ct);
            return await MileageReport(user, month, ct);
        }, ct);
    }
    public Task<MileageReport> SaveMileageMonth(string? userId, DateOnly month, MileageMonthInput input, CancellationToken ct)
    {
        var user = userId ?? Actor;
        return Scoped(MileagePermission(user), async _ =>
        {
            await CheckMileageUser(user, ct);
            MileageLedger.ValidateMonth(month, await CompanyToday(ct));
            var report = await MileageLedger.Writable(db, TenantId, user, Actor, month, input.Version, ct);
            var before = new { report.TotalKm, report.PrivateKm, report.SubmittedAt, report.Version };
            var reason = FleetValidation.Text(input.Reason, 500, "Javítás indoka", required: report.SubmittedAt is not null);
            if (report.Mode == "Monthly")
            {
                if (input.TotalKm is null || input.PrivateKm is null) throw FleetValidation.Invalid("Add meg a teljes és a magánkilométert.");
                MileageLedger.Numbers(input.TotalKm.Value, input.PrivateKm.Value);
                report.TotalKm = input.TotalKm.Value;
                report.PrivateKm = input.PrivateKm.Value;
            }
            else if (input.TotalKm is not null || input.PrivateKm is not null) throw FleetValidation.Invalid("Tételes módban a tételeket javítsd; a havi összeg automatikus.");
            if (input.Submit && report.TotalKm == 0 && !input.ConfirmNoUsage) throw FleetValidation.Invalid("Erősítsd meg, hogy ebben a hónapban nem volt használat.");
            if (input.Submit && !report.LimitCaptured)
            {
                report.LimitKm = (await MileageLedger.Account(db, TenantId, user, month, ct)).MonthlyLimitKm;
                report.LimitCaptured = true;
            }
            report.SubmittedAt = input.Submit ? DateTimeOffset.UtcNow : null;
            MileageLedger.Touch(report, Actor);
            Audit("mileage.month_saved", Guid.Empty, new { user, month, Data = before }, new { user, month, report.TotalKm, report.PrivateKm, report.SubmittedAt, report.Version, Reason = reason });
            await db.SaveChangesAsync(ct);
            return await MileageReport(user, month, ct);
        }, ct);
    }
    public Task<MileageReport> SaveMileageEntry(string? userId, DateOnly month, Guid? entryId, MileageEntryInput input, bool voidEntry, CancellationToken ct)
    {
        var user = userId ?? Actor;
        return Scoped(MileagePermission(user), async _ =>
        {
            await CheckMileageUser(user, ct);
            var today = await CompanyToday(ct);
            MileageLedger.ValidateMonth(month, today);
            MileageLedger.Numbers(input.TotalKm, input.PrivateKm);
            FleetValidation.Date(input.OccurredOn);
            if (input.OccurredOn > today || MileageLedger.MonthOf(input.OccurredOn) != month) throw FleetValidation.Invalid("A tétel dátuma a kiválasztott hónapba essen, és ne legyen jövőbeli.");
            var report = await MileageLedger.Writable(db, TenantId, user, Actor, month, input.MonthVersion, ct);
            if (report.Mode != "Entries") throw Error(409, "mileage_mode", "Havi összesítő módban a havi teljes és magánkilométert módosítsd.");
            var entry = entryId is null ? null : await db.MileageEntries.SingleOrDefaultAsync(x => x.Id == entryId && x.UserId == user && x.Month == month, ct)
                ?? throw Error(404, "mileage_entry", "A km-tétel nem található.");
            if (entry is not null && (entry.Version != input.Version || entry.VoidedAt is not null)) throw Error(409, "mileage_conflict", "A km-tétel időközben megváltozott.");
            var reason = FleetValidation.Text(input.Reason, 500, "Módosítás indoka", required: entry is not null || report.SubmittedAt is not null);
            var before = entry is null ? null : MileageLedger.Row(entry);
            if (!voidEntry && entry?.VehicleId is { } vehicle && entry.EndKilometers is { } end)
            {
                await MileageLedger.CheckInterval(db, vehicle, end, input.TotalKm, entry.Id, ct);
                entry.StartKilometers = end - input.TotalKm;
            }
            if (entry is null)
            {
                if (voidEntry) throw FleetValidation.Invalid("Válassz meglévő tételt.");
                entry = new() { TenantId = TenantId, UserId = user, Month = month, Source = "Manual", RecordedBy = Actor };
                db.MileageEntries.Add(entry);
            }
            var total = report.TotalKm - (before?.TotalKm ?? 0) + (voidEntry ? 0 : input.TotalKm);
            var personal = report.PrivateKm - (before?.PrivateKm ?? 0) + (voidEntry ? 0 : input.PrivateKm);
            MileageLedger.Numbers(total, personal);
            entry.OccurredOn = input.OccurredOn;
            entry.TotalKm = input.TotalKm;
            entry.PrivateKm = input.PrivateKm;
            entry.VoidedAt = voidEntry ? DateTimeOffset.UtcNow : null;
            if (before is not null) { entry.Version++; entry.UpdatedBy = Actor; entry.UpdatedAt = DateTimeOffset.UtcNow; }
            report.TotalKm = total;
            report.PrivateKm = personal;
            report.SubmittedAt = null;
            MileageLedger.Touch(report, Actor);
            Audit("mileage.entry_saved", entry.Id, new { user, month, Data = before }, new { user, month, Data = MileageLedger.Row(entry), Reason = reason });
            await db.SaveChangesAsync(ct);
            return await MileageReport(user, month, ct);
        }, ct);
    }
}
