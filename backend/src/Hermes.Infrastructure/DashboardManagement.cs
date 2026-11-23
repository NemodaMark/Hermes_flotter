using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class DashboardManagement(HermesDbContext db, TenantContext context)
{
    public Task<DashboardSummary> Read(CancellationToken ct)
        => WithAccess(async (member, accessMember, zone) =>
        {
            // Resolve preferences from actual memberships. System access itself has no group preference.
            var preferences = member?.HasCompanyAccess == true ? member.Groups
                .Where(x => x.Group.Companies.Any(c => c.TenantId == member.TenantId)).Select(x => x.Group).ToArray() : [];
            var priority = preferences.Length == 0 ? 0 : preferences.Max(x => x.DashboardPriority);
            var winners = preferences.Where(x => x.DashboardPriority == priority).OrderBy(x => x.Id).ToArray();
            var permissions = accessMember.EffectivePermissions;
            var canRead = permissions.Contains(Permissions.VehiclesRead);
            var canOverview = canRead && permissions.Contains(Permissions.FleetOverviewRead);
            var ledger = permissions.Contains(Permissions.MileageRecord) || permissions.Contains(Permissions.MileageManage);
            var canMileage = ledger || permissions.Any(x => x.StartsWith("vehicles.settlements.", StringComparison.Ordinal));
            var mode = !canOverview || (winners.Length > 0 && winners.All(x => x.DashboardMode == "Vehicle")) ? "Vehicle" : "Overview";
            var source = winners.Length == 1 && winners[0].DashboardMode == mode ? winners[0].Name : null;
            var access = new ResourceAccess(accessMember);
            var visible = VehicleAccess.Query(db, access, Permissions.VehiclesRead);
            // Personal home never falls back to unrelated cars. Assignment does not grant reading rights.
            var overviewScope = VehicleAccess.Query(db, access, Permissions.FleetOverviewRead);
            visible = visible.Where(vehicle => db.VehicleUserAssignments.Any(a => a.VehicleId == vehicle.Id && a.UserId == context.UserSubject && a.ReleasedAt == null)
                || (canOverview && overviewScope.Any(candidate => candidate.Id == vehicle.Id)));
            var vehicles = canRead ? await ReadVehicles(visible, access,
                TimeZoneInfo.FindSystemTimeZoneById(zone), ct) : [];
            return new DashboardSummary(mode, priority, source, canRead, vehicles)
            {
                CanReadOverview = canOverview,
                CanReadMileage = ledger,
                CanRecordMileage = canMileage,
                MileageDueMonth = ledger ? await MileageLedger.Due(db, context.UserSubject!, FleetManagement.LocalDay(DateTimeOffset.UtcNow, zone), ct) : null,
                Today = FleetManagement.LocalDay(DateTimeOffset.UtcNow, zone)
            };
        }, ct);

    public Task<DashboardMileageChart> ReadMileageChart(int months, string[] userIds, CancellationToken ct) => WithAccess(async (_, member, zone) =>
    {
        var permissions = member.EffectivePermissions;
        var canSelectPeople = permissions.Contains(Permissions.MileageManage);
        var actor = context.UserSubject!;
        if (!canSelectPeople && (!permissions.Contains(Permissions.MileageRecord) || userIds.Any(id => id != actor)))
            throw UserAccounts.Error(403, "permission_denied", "Mások futásteljesítményéhez céges km-elszámolási jog szükséges.");
        if (months is < 1 or > 12 || userIds.Length > 100 || userIds.Any(string.IsNullOrWhiteSpace))
            throw FleetValidation.Invalid("Válassz 1–12 hónapot és legfeljebb 100 céges felhasználót.");

        var company = context.TenantId!.Value;
        var current = MileageLedger.MonthOf(FleetManagement.LocalDay(DateTimeOffset.UtcNow, zone));
        var first = current.AddMonths(1 - months);
        var reports = db.MileageMonths.AsNoTracking().Where(x => x.TenantId == company && x.Month >= first && x.Month <= current
            && (x.TotalKm > 0 || x.SubmittedAt != null));
        var people = canSelectPeople ? await (
            from membership in db.Memberships.AsNoTracking()
            join user in db.Users.AsNoTracking() on membership.UserSubject equals user.Id
            where membership.TenantId == company && (membership.IsActive || reports.Any(x => x.UserId == membership.UserSubject))
            orderby user.DisplayName, user.Id
            select new DashboardMileagePerson(user.Id, user.DisplayName == null || user.DisplayName == "" ? user.Id : user.DisplayName)).ToArrayAsync(ct) : [];
        var eligible = people.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        if (canSelectPeople && userIds.Any(id => !eligible.Contains(id)))
            throw UserAccounts.Error(404, "mileage_user", "A kiválasztott céges felhasználó nem érhető el.");
        var selected = userIds.Distinct(StringComparer.Ordinal).ToArray();
        var split = canSelectPeople && selected.Length > 0;
        var scope = !canSelectPeople ? [actor] : split ? selected : eligible.ToArray();
        var points = await reports.Where(x => scope.Contains(x.UserId))
            .GroupBy(x => new { x.Month, UserId = split ? x.UserId : null })
            .OrderBy(x => x.Key.Month).ThenBy(x => x.Key.UserId)
            .Select(x => new DashboardMileagePoint(x.Key.UserId, x.Key.Month, x.Sum(r => r.TotalKm))).ToArrayAsync(ct);
        return new DashboardMileageChart(first, months, canSelectPeople, people, points);
    }, ct);

    public Task<DashboardOverview> ReadOverview(string? site, string? status, string? search, int months, bool includeMileage, CancellationToken ct)
        => WithAccess(async (_, member, zone) =>
        {
            if (!member.EffectivePermissions.Contains(Permissions.FleetOverviewRead) || !member.EffectivePermissions.Contains(Permissions.VehiclesRead))
                throw UserAccounts.Error(403, "permission_denied", "Nincs jogosultságod a flottaáttekintő megtekintéséhez.");
            var access = new ResourceAccess(member);
            var overviewScope = VehicleAccess.Query(db, access, Permissions.FleetOverviewRead);
            var visible = VehicleAccess.Query(db, access, Permissions.VehiclesRead)
                .Where(vehicle => overviewScope.Any(candidate => candidate.Id == vehicle.Id));
            visible = VehicleAccess.Filter(db, visible, site ?? "all", status ?? "all", search);
            if (months is < 1 or > 12)
                throw UserAccounts.Error(400, "invalid_period", "Az időszak 1 és 12 hónap közötti lehet.");

            var now = DateTimeOffset.UtcNow;
            var timeZone = TimeZoneInfo.FindSystemTimeZoneById(zone);
            var today = FleetManagement.LocalDay(now, zone);
            var cars = await ReadVehicles(visible, access, timeZone, ct);
            return includeMileage ? await Mileage(cars, today, now, timeZone, months, ct) : new(today, cars, [], []);
        }, ct);

    private async Task<DashboardOverview> Mileage(DashboardVehicle[] cars, DateOnly today,
        DateTimeOffset now, TimeZoneInfo timeZone, int months, CancellationToken ct)
    {
        var first = new DateOnly(today.Year, today.Month, 1).AddMonths(1 - months);
        var boundary = first.ToDateTime(TimeOnly.MinValue);
        var start = new DateTimeOffset(boundary, timeZone.GetUtcOffset(boundary)).ToUniversalTime();
        var ids = cars.Select(x => x.Vehicle.Id).ToArray();
        var baseline = await db.Vehicles.Where(v => ids.Contains(v.Id)).Select(v => new
        {
            v.Id,
            Kilometers = db.OdometerReadings.Where(r => r.VehicleId == v.Id && r.RecordedAt < start)
                .OrderByDescending(r => r.RecordedAt).ThenByDescending(r => r.Id).Select(r => (long?)r.Kilometers).FirstOrDefault()
        }).ToDictionaryAsync(v => v.Id, v => v.Kilometers, ct);
        var readings = await db.OdometerReadings.AsNoTracking()
            .Where(r => r.RecordedAt >= start && r.RecordedAt <= now && ids.Contains(r.VehicleId))
            .OrderBy(r => r.RecordedAt).ThenBy(r => r.Id)
            .Select(r => new { r.VehicleId, r.Kilometers, r.RecordedAt }).ToArrayAsync(ct);
        var monthly = new long?[months];
        var totals = new Dictionary<Guid, long>();
        foreach (var reading in readings)
        {
            var previous = baseline[reading.VehicleId];
            baseline[reading.VehicleId] = reading.Kilometers;
            if (previous is not { } value || reading.Kilometers < value) continue;
            var local = TimeZoneInfo.ConvertTime(reading.RecordedAt, timeZone);
            var month = (local.Year - first.Year) * 12 + local.Month - first.Month;
            if (month < 0 || month >= monthly.Length) continue;
            var distance = reading.Kilometers - value;
            monthly[month] = (monthly[month] ?? 0) + distance;
            totals[reading.VehicleId] = totals.GetValueOrDefault(reading.VehicleId) + distance;
        }

        var ranking = cars.Select(x => x.Vehicle)
            .Where(v => totals.GetValueOrDefault(v.Id) > 0)
            .OrderByDescending(v => totals[v.Id]).ThenBy(v => v.Registration).ThenBy(v => v.Id).Take(5)
            .Select(v => new DashboardMileageVehicle(v.Id, v.Registration, v.Make, v.Model, totals[v.Id])).ToArray();
        return new(today, cars, monthly.Select((km, index) => new DashboardMileageMonth(first.AddMonths(index), km)).ToArray(), ranking);
    }

    private Task<T> WithAccess<T>(Func<TenantMembership?, TenantMembership, string, Task<T>> action, CancellationToken ct)
    {
        var company = context.TenantId!.Value;
        var actor = context.UserSubject!;
        return TenantTransaction.RunAsync(db, company, async () =>
        {
            await UserAccounts.LockSystemAccess(db, ct, shared: true);
            await AccessRules.LockTenant(db, company, ct);
            var system = await UserAccounts.IsSystemManager(db, actor, ct);
            var membership = await db.Memberships.AsNoTracking().WithAccess()
                .SingleOrDefaultAsync(x => x.TenantId == company && x.UserSubject == actor && x.IsActive, ct);
            if (!system && membership?.HasCompanyAccess != true)
                throw UserAccounts.Error(403, "permission_denied", "Nincs aktív céges hozzáférésed.");
            var accessMember = system ? TenantDirectory.SystemMembership(actor, company) : membership!;
            var zone = await db.Tenants.Where(x => x.Id == company).Select(x => x.TimeZone).SingleAsync(ct);
            return await action(membership, accessMember, zone);
        }, ct);
    }

    private async Task<DashboardVehicle[]> ReadVehicles(IQueryable<Vehicle> query, ResourceAccess access, TimeZoneInfo zone, CancellationToken ct)
    {
        var actor = context.UserSubject;
        var rows = await (from v in query.AsNoTracking()
                join p in db.VehicleProfiles on v.Id equals p.VehicleId into profiles from p in profiles.DefaultIfEmpty()
                join ap in db.VehicleServiceAppointments on v.Id equals ap.VehicleId into appointments from appointment in appointments.DefaultIfEmpty()
                join a in db.VehicleSiteAssignments on v.Id equals a.VehicleId into assignments from a in assignments.DefaultIfEmpty()
                join s in db.Sites on a.SiteId equals s.Id into sites from s in sites.DefaultIfEmpty()
                orderby v.Registration
                select new { Car = v, Profile = p, SiteId = (Guid?)a.SiteId, SiteName = s.Name, Appointment = (DateTimeOffset?)appointment.StartsAt,
                    Mine = db.VehicleUserAssignments.Any(u => u.VehicleId == v.Id && u.UserId == actor && u.ReleasedAt == null),
                    BookingEnabled = db.VehicleBookingSettings.Any(b => b.VehicleId == v.Id && b.Enabled) }).ToArrayAsync(ct);
        return rows.Select(x => new DashboardVehicle(
                new VehicleSummary(x.Car.Id, x.Car.Registration, x.Car.Make, x.Car.Model, x.Car.Status.ToString())
                { BodyType = x.Profile?.BodyType ?? "Unknown", Color = x.Profile?.Color, Version = x.Car.Version, SiteId = x.SiteId, SiteName = x.SiteName, OdometerKm = x.Car.OdometerKm,
                    Permissions = VehicleAccess.PermissionsFor(access, x.SiteId) },
                x.Profile?.BodyType ?? "Unknown", x.Profile?.Color, x.Profile?.InspectionDueDate, x.Profile?.InsuranceDueDate,
                x.Profile?.NextServiceDate, x.Profile?.NextServiceKm, x.Mine)
                { BookingEnabled = access.Allows(Permissions.BookingsRead, x.SiteId) || access.Allows(Permissions.BookingsManage, x.SiteId) ? x.BookingEnabled : null,
                  ServiceAppointmentAt = x.Appointment is { } appointment && access.Allows(Permissions.ServicesRead, x.SiteId)
                    ? TimeZoneInfo.ConvertTime(appointment, zone) : null }).ToArray();
    }
}
