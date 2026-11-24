using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    private IQueryable<Vehicle> EventVehicles(ResourceAccess access, bool manage)
    {
        var permitted = VehicleAccess.Query(db, access, Permissions.VehicleEventsManage);
        if (!manage) permitted = permitted.Union(VehicleAccess.Query(db, access, Permissions.VehicleEventsRead));
        var ids = permitted.Select(x => x.Id);
        return VehicleAccess.Query(db, access, Permissions.VehiclesRead).Where(x => x.Status != Domain.VehicleStatus.Archived && ids.Contains(x.Id));
    }

    public Task<FleetEventOptions> FleetEventTargets(string? search, CancellationToken ct) => Scoped(Permissions.VehicleEventsManage, async access =>
    {
        var vehicles = await VehicleAccess.Filter(db, EventVehicles(access, manage: true), "all", "all", search)
            .OrderBy(x => x.Registration).ThenBy(x => x.Id).Take(51)
            .Select(x => new FleetEventVehicle(x.Id, x.Registration, x.Make, x.Model)).ToArrayAsync(ct);
        return new FleetEventOptions(access.CompanyWide(Permissions.VehicleEventsManage), vehicles.Take(50).ToArray(), vehicles.Length > 50);
    }, ct);

    public Task<PageResult<FleetEventRow>> ReadFleetEvents(DateOnly month, int page, CancellationToken ct)
    {
        var read = context.Permissions.Contains(Permissions.VehicleEventsRead) ? Permissions.VehicleEventsRead : Permissions.VehicleEventsManage;
        return Scoped(read, async access =>
        {
            FleetValidation.Date(month);
            if (month.Day != 1) throw FleetValidation.Invalid("A hónap első napját add meg.");
            FleetValidation.Page(page);
            var through = month.AddMonths(1).AddDays(-1);
            var allVehicles = EventVehicles(access, manage: false);
            var eligibleIds = allVehicles.Select(x => x.Id);
            var manageIds = EventVehicles(access, manage: true).Select(x => x.Id);
            var manageFleet = access.CompanyWide(Permissions.VehicleEventsManage);
            var readFleet = manageFleet || access.CompanyWide(Permissions.VehicleEventsRead) || await allVehicles.AnyAsync(ct);
            var events = await db.FleetEvents.AsNoTracking().Where(e => e.StartsOn <= through && (e.EndsOn == null || e.EndsOn >= month)
                && (e.Repeat != "Once" || e.StartsOn >= month)
                && (e.StoppedOn == null || e.StoppedOn > month)
                && (e.VehicleId == null ? readFleet : eligibleIds.Contains(e.VehicleId.Value)))
                .Select(e => new
                {
                    Event = e,
                    Registration = db.Vehicles.Where(v => v.Id == e.VehicleId).Select(v => v.Registration).FirstOrDefault(),
                    CanManage = e.StoppedOn == null && (e.VehicleId == null ? manageFleet : manageIds.Contains(e.VehicleId.Value))
                }).ToArrayAsync(ct);
            var rows = events.Select(x => EventRow(x.Event, x.Registration, x.CanManage, Occurrences(x.Event, month, through)))
                .Where(x => x.Occurrences.Length > 0).OrderBy(x => x.Occurrences[0]).ThenBy(x => x.Title).ThenBy(x => x.Id).ToArray();
            const int size = 25;
            page = Math.Min(page, Math.Max(1, (rows.Length + size - 1) / size));
            return new PageResult<FleetEventRow>(rows.Skip((page - 1) * size).Take(size).ToArray(), rows.Length, page, size);
        }, ct);
    }

    private async Task<string?> CheckEventTarget(ResourceAccess access, Guid? id, CancellationToken ct)
    {
        if (id is null)
        {
            if (!access.CompanyWide(Permissions.VehicleEventsManage))
                throw Error(403, "fleet_event_scope", "Az egész flottára teljes céges eseménykezelési jog szükséges.");
            return null;
        }
        await Car(id.Value, access, Permissions.VehiclesRead, ct);
        return (await Car(id.Value, access, Permissions.VehicleEventsManage, ct, write: true)).Registration;
    }

    private static FleetEventRow EventRow(FleetEvent e, string? registration, bool canManage, DateOnly[] occurrences) =>
        new(e.Id, e.VehicleId, registration, e.Title, e.StartsOn, e.Repeat, e.Every, e.EndsOn, e.Notes, e.StoppedOn, e.Version, canManage, occurrences);

    private async Task<FleetEvent> FindEvent(Guid id, CancellationToken ct) => await db.FleetEvents.SingleOrDefaultAsync(e => e.Id == id, ct)
        ?? throw Error(404, "fleet_event_missing", "Az esemény nem található.");

    public Task<FleetEventRow> SaveFleetEvent(Guid? id, FleetEventInput input, CancellationToken ct) => Scoped(Permissions.VehicleEventsManage, async access =>
    {
        var repeat = FleetValidation.Choice(input.Repeat, "Ismétlődés", "Once", "Day", "Week", "Month", "Year");
        FleetValidation.Date(input.StartsOn);
        FleetValidation.Date(input.EndsOn);
        if (input.Every is < 1 or > 999 || input.EndsOn < input.StartsOn || repeat == "Once" && (input.Every != 1 || input.EndsOn is not null))
            throw FleetValidation.Invalid("Érvényes ismétlődési időközt és befejezést adj meg.");
        var title = FleetValidation.Text(input.Title, 120, "Esemény neve", required: true)!;
        var notes = FleetValidation.Text(input.Notes, 500, "Megjegyzés");
        var existing = id is null ? null : await FindEvent(id.Value, ct);
        var target = existing is null ? input.VehicleId : existing.VehicleId;
        var registration = await CheckEventTarget(access, target, ct);
        if (existing is not null && (existing.StoppedOn is not null || input.VehicleId != existing.VehicleId))
            throw Error(409, "fleet_event_state", "Az esemény már lezárult, vagy megváltozott a céljármű.");
        if (existing is not null) FleetValidation.Revision(existing.Version, input.Version);
        var item = existing ?? new FleetEvent { TenantId = TenantId, VehicleId = target, Title = title };
        var before = existing is null ? null : EventRow(existing, registration, true, []);
        item.Title = title; item.Notes = notes; item.StartsOn = input.StartsOn;
        item.Repeat = repeat; item.Every = input.Every; item.EndsOn = input.EndsOn;
        if (existing is null) db.FleetEvents.Add(item);
        else item.Version++;
        var after = EventRow(item, registration, true, []);
        Audit(existing is null ? "vehicle.event_created" : "vehicle.event_updated", item.Id, before, after, target);
        await db.SaveChangesAsync(ct);
        return after;
    }, ct);

    public Task<bool> StopFleetEvent(Guid id, FleetEventStop input, CancellationToken ct) => Scoped(Permissions.VehicleEventsManage, async access =>
    {
        var item = await FindEvent(id, ct);
        var registration = await CheckEventTarget(access, item.VehicleId, ct);
        if (item.StoppedOn is not null) return true;
        FleetValidation.Revision(item.Version, input.Version);
        var before = EventRow(item, registration, true, []);
        item.StoppedOn = await CompanyToday(ct);
        item.Version++;
        Audit("vehicle.event_stopped", id, before, EventRow(item, registration, false, []), item.VehicleId);
        await db.SaveChangesAsync(ct);
        return true;
    }, ct);

    private static DateOnly[] Occurrences(FleetEvent item, DateOnly from, DateOnly through)
    {
        if (item.EndsOn is { } end && end < through) through = end;
        if (item.StoppedOn is { } stop && stop <= through) through = stop.AddDays(-1);
        var start = item.StartsOn;
        if (through < from || through < start) return [];
        if (item.Repeat == "Once") return start >= from ? [start] : [];

        var dates = new List<DateOnly>();
        if (item.Repeat is "Day" or "Week")
        {
            var step = item.Every * (item.Repeat == "Week" ? 7 : 1);
            var gap = Math.Max(0, from.DayNumber - start.DayNumber);
            for (var offset = (gap + step - 1) / step * step; offset <= through.DayNumber - start.DayNumber; offset += step)
                dates.Add(start.AddDays(offset));
            return dates.ToArray();
        }

        int MonthsSinceStart(DateOnly date) => (date.Year - start.Year) * 12 + date.Month - start.Month;
        var months = item.Every * (item.Repeat == "Year" ? 12 : 1);
        for (var offset = Math.Max(0, MonthsSinceStart(from) / months) * months; offset <= MonthsSinceStart(through); offset += months)
        {
            var date = start.AddMonths(offset);
            if (date >= from && date <= through) dates.Add(date);
        }
        return dates.ToArray();
    }
}
