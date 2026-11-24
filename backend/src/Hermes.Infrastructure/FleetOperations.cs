using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    private async Task<DateOnly> CompanyToday(CancellationToken ct)
    {
        var zone = await db.Tenants.Where(x => x.Id == TenantId).Select(x => x.TimeZone).SingleAsync(ct);
        return LocalDay(DateTimeOffset.UtcNow, zone);
    }
    internal static DateOnly LocalDay(DateTimeOffset now, string zone)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(zone)).DateTime);

    private async Task OperationsRead(Guid vehicleId, ResourceAccess access, string permission, CancellationToken ct)
    {
        await Car(vehicleId, access, Permissions.VehiclesRead, ct);
        await Car(vehicleId, access, permission, ct);
    }

    private static DateOnly NextMonth(DateOnly month)
    {
        FleetValidation.Date(month);
        if (month.Day != 1) throw FleetValidation.Invalid("A hónap első napját add meg.");
        return month.AddMonths(1);
    }

    public Task<BookingCalendar> Bookings(Guid vehicleId, DateOnly month, CancellationToken ct) => Scoped(Permissions.BookingsRead, async access =>
    {
        await OperationsRead(vehicleId, access, Permissions.BookingsRead, ct);
        var next = NextMonth(month);
        var items = await (from booking in db.VehicleBookings.AsNoTracking()
            join user in db.Users on booking.UserId equals user.Id
            where booking.VehicleId == vehicleId && booking.CancelledAt == null && booking.StartsOn < next && booking.EndsOn >= month
            orderby booking.StartsOn, booking.Id
            select new BookingRow(booking.Id, booking.UserId, user.DisplayName ?? user.Id, booking.StartsOn, booking.EndsOn)).ToArrayAsync(ct);
        return new BookingCalendar(await BookingEnabled(vehicleId, ct), await CompanyToday(ct), items);
    }, ct);

    public Task<bool> SetBooking(Guid vehicleId, BookingSettingsInput input, CancellationToken ct) => Scoped(Permissions.BookingsManage, async access =>
    {
        await Car(vehicleId, access, Permissions.BookingsManage, ct, write: true);
        var settings = await db.VehicleBookingSettings.SingleOrDefaultAsync(x => x.VehicleId == vehicleId, ct);
        if ((settings?.Enabled ?? false) == input.Enabled) return input.Enabled;
        if (settings is null)
        {
            settings = new() { TenantId = TenantId, VehicleId = vehicleId };
            db.VehicleBookingSettings.Add(settings);
        }
        settings.Enabled = input.Enabled;
        Audit("vehicle.bookings_settings", vehicleId, new { Enabled = !input.Enabled }, new { input.Enabled }, vehicleId);
        await db.SaveChangesAsync(ct);
        return settings.Enabled;
    }, ct);

    private Task<bool> BookingEnabled(Guid id, CancellationToken ct) => db.VehicleBookingSettings.AnyAsync(x => x.VehicleId == id && x.Enabled, ct);

    public Task<bool> BookingSetting(Guid id, CancellationToken ct) => Scoped(Permissions.BookingsManage, async access =>
    {
        await Car(id, access, Permissions.BookingsManage, ct);
        return await BookingEnabled(id, ct);
    }, ct);

    public Task<BookingRow> Book(Guid vehicleId, BookingInput input, CancellationToken ct) => Scoped(Permissions.BookingsCreate, async access =>
    {
        await Car(vehicleId, access, Permissions.VehiclesRead, ct);
        var car = await Car(vehicleId, access, Permissions.BookingsCreate, ct, write: true);
        if (car.Status != Domain.VehicleStatus.Active || !await BookingEnabled(vehicleId, ct))
            throw Error(409, "booking_disabled", "Ez a jármű jelenleg nem foglalható.");
        FleetValidation.Date(input.StartsOn);
        FleetValidation.Date(input.EndsOn);
        if (input.StartsOn < await CompanyToday(ct) || input.EndsOn.DayNumber - input.StartsOn.DayNumber is < 0 or > 6)
            throw FleetValidation.Invalid("Egy foglalás ma vagy később kezdődhet, és legfeljebb hét egymást követő napra szólhat.");
        var member = await db.Memberships.AsNoTracking().WithAccess().SingleOrDefaultAsync(x => x.TenantId == TenantId && x.UserSubject == Actor && x.IsActive, ct);
        if (member?.HasCompanyAccess != true) throw Error(403, "booking_membership", "Foglaláshoz aktív cégtagság szükséges.");
        var conflict = await db.VehicleBookings.AnyAsync(x => x.VehicleId == vehicleId && x.CancelledAt == null
            && x.StartsOn <= input.EndsOn && x.EndsOn >= input.StartsOn, ct);
        if (conflict) throw Error(409, "booking_conflict", "A jármű a kiválasztott időszakban már foglalt.");
        var item = new VehicleBooking { TenantId = TenantId, VehicleId = vehicleId, UserId = Actor, StartsOn = input.StartsOn, EndsOn = input.EndsOn };
        db.VehicleBookings.Add(item);
        Audit("vehicle.booked", item.Id, null, new { item.UserId, item.StartsOn, item.EndsOn }, vehicleId);
        await db.SaveChangesAsync(ct);
        var name = await db.Users.Where(x => x.Id == Actor).Select(x => x.DisplayName).SingleAsync(ct);
        return new BookingRow(item.Id, Actor, name ?? Actor, item.StartsOn, item.EndsOn);
    }, ct);

    public Task<bool> CancelBooking(Guid vehicleId, Guid bookingId, bool manage, CancellationToken ct)
    {
        var permission = manage ? Permissions.BookingsManage : Permissions.BookingsCreate;
        return Scoped(permission, async access =>
        {
            await Car(vehicleId, access, Permissions.VehiclesRead, ct);
            await Car(vehicleId, access, permission, ct, write: true);
            var item = await db.VehicleBookings.SingleOrDefaultAsync(x => x.VehicleId == vehicleId && x.Id == bookingId && (manage || x.UserId == Actor), ct)
                ?? throw Error(404, "booking_not_found", "A foglalás nem található.");
            if (item.CancelledAt is not null) return true;
            if (item.EndsOn < await CompanyToday(ct)) throw Error(409, "booking_past", "A befejezett foglalás megmarad az előzményekben.");
            item.CancelledBy = Actor;
            item.CancelledAt = DateTimeOffset.UtcNow;
            Audit("vehicle.booking_cancelled", item.Id, new { item.UserId, item.StartsOn, item.EndsOn }, new { item.CancelledAt }, vehicleId);
            await db.SaveChangesAsync(ct);
            return true;
        }, ct);
    }

    public Task<ServiceAppointmentInput?> ServiceAppointment(Guid id, CancellationToken ct) => Scoped(Permissions.ServicesRead, async access =>
    {
        await Car(id, access, Permissions.ServicesRead, ct);
        return await db.VehicleServiceAppointments.Where(x => x.VehicleId == id).Select(x => new ServiceAppointmentInput(x.StartsAt, x.Notes)).SingleOrDefaultAsync(ct);
    }, ct);

    public Task<bool> PlanService(Guid id, ServiceAppointmentInput? input, CancellationToken ct) => Scoped(Permissions.ServicesManage, async access =>
    {
        await Car(id, access, Permissions.ServicesManage, ct, write: true);
        var existing = await db.VehicleServiceAppointments.SingleOrDefaultAsync(x => x.VehicleId == id, ct);
        var before = existing is null ? null : new ServiceAppointmentInput(existing.StartsAt, existing.Notes);
        if (input is not null)
        {
            if (input.StartsAt <= DateTimeOffset.UtcNow || input.StartsAt.Year > 2100) throw FleetValidation.Invalid("Jövőbeli szervizidőpontot adj meg.");
            existing ??= new VehicleServiceAppointment { VehicleId = id, TenantId = TenantId };
            existing.StartsAt = input.StartsAt.ToUniversalTime();
            existing.Notes = FleetValidation.Text(input.Notes, 500, "Megjegyzés");
            if (db.Entry(existing).State == EntityState.Detached) db.VehicleServiceAppointments.Add(existing);
        }
        else if (existing is not null) db.VehicleServiceAppointments.Remove(existing);
        else return true;
        Audit("vehicle.service_appointment", id, before, input is null ? null : new ServiceAppointmentInput(existing!.StartsAt, existing.Notes), id);
        await db.SaveChangesAsync(ct);
        return true;
    }, ct);

    public Task<FuelMonth> Fuel(Guid id, DateOnly month, CancellationToken ct) => Scoped(Permissions.FuelRead, async access =>
    {
        await Car(id, access, Permissions.FuelRead, ct);
        var next = NextMonth(month);
        var baseline = await db.VehicleFuelEntries.AsNoTracking().Where(x => x.VehicleId == id && x.FueledOn < month && x.VoidedAt == null && x.IsFullTank)
            .OrderByDescending(x => x.FueledOn).ThenByDescending(x => x.Kilometers).Select(x => (DateOnly?)x.FueledOn).FirstOrDefaultAsync(ct);
        var start = baseline ?? month;
        var entries = await db.VehicleFuelEntries.AsNoTracking().Where(x => x.VehicleId == id && x.FueledOn >= start && x.FueledOn < next)
            .OrderBy(x => x.FueledOn).ThenBy(x => x.Kilometers).ThenBy(x => x.Id)
            .Select(x => new FuelEntryRow(x.Id, x.FueledOn, x.Kilometers, x.Liters, x.Amount, x.Currency, x.Receipt != null, x.VoidedAt != null)
            {
                ReceiptNumber = x.ReceiptNumber, IsFullTank = x.IsFullTank, Version = x.Version,
                RecordedBy = x.RecordedBy, RecordedAt = x.RecordedAt, UpdatedBy = x.UpdatedBy, UpdatedAt = x.UpdatedAt
            }).ToArrayAsync(ct);
        var averages = new Dictionary<Guid, decimal>();
        long? anchor = null, previous = null;
        decimal liters = 0, measuredLiters = 0;
        long measuredKm = 0;
        foreach (var row in entries.Where(x => !x.IsVoided))
        {
            if (previous is not null && row.Kilometers < previous) { anchor = null; liters = 0; }
            previous = row.Kilometers;
            if (anchor is not null) liters += row.Liters;
            if (!row.IsFullTank) continue;
            if (anchor is not null && row.Kilometers > anchor && row.FueledOn >= month)
            {
                var distance = row.Kilometers - anchor.Value;
                averages[row.Id] = Math.Round(100 * liters / distance, 2);
                measuredKm += distance;
                measuredLiters += liters;
            }
            anchor = row.Kilometers;
            liters = 0;
        }
        var rows = entries.Where(x => x.FueledOn >= month).Reverse()
            .Select(x => x with { LitersPer100Km = averages.TryGetValue(x.Id, out var average) ? average : null }).ToArray();
        return new FuelMonth(rows, rows.Where(x => !x.IsVoided).GroupBy(x => x.Currency).OrderBy(x => x.Key)
            .Select(x => new FuelTotal(x.Key, x.Sum(y => y.Liters), x.Key is null ? null : x.Sum(y => y.Amount))).ToArray())
        {
            MeasuredKilometers = measuredKm,
            LitersPer100Km = measuredKm > 0 ? Math.Round(100 * measuredLiters / measuredKm, 2) : null
        };
    }, ct);

    private async Task ValidateFuelDay(DateOnly date, long kilometers, CancellationToken ct)
    {
        FleetValidation.Date(date);
        if (date > await CompanyToday(ct)) throw FleetValidation.Invalid("A tankolás dátuma nem lehet jövőbeli.");
        FleetValidation.Range(kilometers, 100_000_000, "Kilométerállás");
    }

    private async Task ValidateFuel(FuelEntryInput input, CancellationToken ct)
    {
        await ValidateFuelDay(input.FueledOn, input.Kilometers, ct);
        FleetValidation.Range(input.Liters, 999_999, "Liter", 3);
        FleetValidation.Range(input.Amount, 999_999_999_999.99m, "Összeg", 2);
        if (input.Liters == 0) throw FleetValidation.Invalid("Adj meg pozitív mennyiséget.");
        if (input.Amount is not null) FleetValidation.Currency(input.Currency);
        else if (input.Currency is not null) throw FleetValidation.Invalid("Pénznemet összeggel együtt adj meg.");
        FleetValidation.Text(input.ReceiptNumber, 100, "Bizonylatszám");
    }

    public Task<FuelMileagePreview> PreviewFuelMileage(Guid id, DateOnly date, long kilometers, CancellationToken ct) => Scoped(Permissions.FuelManage, async access =>
    {
        await Car(id, access, Permissions.FuelManage, ct, write: true);
        await MileageLedger.AuthorizeCapture(db, context, ct);
        await ValidateFuelDay(date, kilometers, ct);
        return new FuelMileagePreview(await FuelMileageDistance(id, date, kilometers, ct));
    }, ct);

    private async Task<long?> FuelMileageDistance(Guid id, DateOnly date, long kilometers, CancellationToken ct)
    {
        var zone = await db.Tenants.Where(x => x.Id == TenantId).Select(x => x.TimeZone).SingleAsync(ct);
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(zone);
        DateTimeOffset Midnight(DateOnly day) => TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), timeZone);
        var month = MileageLedger.MonthOf(date);
        var begin = Midnight(month);
        var end = Midnight(date.AddDays(1));
        var assignments = db.VehicleUserAssignments.Where(x => x.VehicleId == id && x.AssignedAt < end);
        var assignment = await assignments.Where(x => x.ReleasedAt == null || x.ReleasedAt >= end)
            .Select(x => new { x.UserId, x.AssignedAt }).SingleOrDefaultAsync(ct);
        if (assignment is not null && assignment.UserId != Actor) return null;
        var change = assignment?.AssignedAt ?? await assignments.MaxAsync(x => x.ReleasedAt < end ? x.ReleasedAt : null, ct);
        if (change > begin) begin = change.Value;
        var fromDay = LocalDay(begin, zone);
        var fromMidnight = begin == Midnight(fromDay);
        var odometers = db.OdometerReadings.Where(x => x.VehicleId == id && x.RecordedAt >= begin && x.RecordedAt < end);
        var fuels = db.VehicleFuelEntries.Where(x => x.VehicleId == id && x.VoidedAt == null && x.FueledOn >= fromDay && x.FueledOn <= date);
        var entries = db.MileageEntries.Where(x => x.VehicleId == id && x.VoidedAt == null && x.OccurredOn >= fromDay && x.OccurredOn <= date);

        // The latest physical reading is also a barrier when it cannot be attributed to this driver.
        var readings = odometers.Select(x => new { Km = (long?)x.Kilometers, Own = assignment != null || x.RecordedBy == Actor })
            .Concat(fuels.Select(x => new { Km = (long?)x.Kilometers, Own = (x.FueledOn > fromDay || fromMidnight || x.RecordedAt >= begin)
                && (assignment != null || x.RecordedBy == Actor) }))
            .Concat(entries.Select(x => new { Km = x.EndKilometers, Own = x.UserId == Actor && (x.OccurredOn > fromDay || fromMidnight || x.RecordedAt >= begin) }));
        var previous = await readings.Where(x => x.Km != null).OrderByDescending(x => x.Km).ThenByDescending(x => x.Own).FirstOrDefaultAsync(ct);
        if (previous is not { Own: true, Km: { } start } || start > kilometers) return null;
        var distance = kilometers - start;
        return await MileageLedger.HasOverlap(db, id, kilometers, distance, null, ct) ? null : distance;
    }

    private static FuelEntryRow FuelRow(VehicleFuelEntry item) => new(item.Id, item.FueledOn, item.Kilometers, item.Liters, item.Amount,
        item.Currency, item.Receipt is not null, item.VoidedAt is not null)
    {
        ReceiptNumber = item.ReceiptNumber, IsFullTank = item.IsFullTank, Version = item.Version,
        RecordedBy = item.RecordedBy, RecordedAt = item.RecordedAt, UpdatedBy = item.UpdatedBy, UpdatedAt = item.UpdatedAt
    };

    public Task<FuelEntryRow> RecordFuel(Guid id, FuelEntryInput input, byte[]? receipt, CancellationToken ct) => Scoped(Permissions.FuelManage, async access =>
    {
        await Car(id, access, Permissions.FuelManage, ct, write: true);
        await ValidateFuel(input, ct);
        if (input.Usage is not null && input.AutomaticMileage is not null)
            throw FleetValidation.Invalid("Egyféle km-elszámolást adj meg.");
        var usage = input.Usage;
        if (input.AutomaticMileage is { } automatic)
        {
            await MileageLedger.AuthorizeCapture(db, context, ct);
            var distance = await FuelMileageDistance(id, input.FueledOn, input.Kilometers, ct);
            if (distance is null || distance != automatic.TotalKm)
                throw Error(409, "fuel_mileage_changed", "Az elszámolható távolság időközben megváltozott. Ellenőrizd az új értéket.");
            usage = new(MileageLedger.MonthOf(input.FueledOn), distance.Value, automatic.PrivateKm);
        }
        var item = new VehicleFuelEntry
        {
            TenantId = TenantId, VehicleId = id, FueledOn = input.FueledOn, Kilometers = input.Kilometers, Liters = input.Liters,
            Amount = input.Amount, Currency = input.Amount is null ? null : FleetValidation.Currency(input.Currency), RecordedBy = Actor, Receipt = receipt,
            ReceiptNumber = FleetValidation.Text(input.ReceiptNumber, 100, "Bizonylatszám"), IsFullTank = input.IsFullTank
        };
        db.VehicleFuelEntries.Add(item);
        await MileageLedger.Capture(db, context, id, "Fuel", item.Id, item.FueledOn, item.Kilometers, usage, ct);
        var row = FuelRow(item);
        Audit("vehicle.fuel_recorded", item.Id, null, row, id);
        await db.SaveChangesAsync(ct);
        return row;
    }, ct);

    public Task<FuelEntryRow> UpdateFuel(Guid id, Guid entryId, UpdateFuelEntryInput input, CancellationToken ct) => Scoped(Permissions.FuelManage, async access =>
    {
        await Car(id, access, Permissions.FuelManage, ct, write: true);
        var item = await db.VehicleFuelEntries.SingleOrDefaultAsync(x => x.VehicleId == id && x.Id == entryId, ct)
            ?? throw Error(404, "fuel_not_found", "A tankolás nem található.");
        if (item.VoidedAt is not null) throw Error(409, "fuel_voided", "Érvénytelenített tankolás nem módosítható.");
        if (input.Version != item.Version) throw Error(409, "fuel_conflict", "A tankolás időközben megváltozott. Frissítsd a listát.");
        var reason = FleetValidation.Text(input.Reason, 500, "Módosítás indoka", required: true);
        if (input.Data is null) throw FleetValidation.Invalid("Add meg a tankolás adatait.");
        if (input.Data.Usage is not null || input.Data.AutomaticMileage is not null) throw FleetValidation.Invalid("A korábban elszámolt kilométert a havi elszámolásban javítsd.");
        await ValidateFuel(input.Data, ct);
        var before = FuelRow(item);
        item.FueledOn = input.Data.FueledOn;
        item.Kilometers = input.Data.Kilometers;
        item.Liters = input.Data.Liters;
        if (input.Data.Amount is not null)
        {
            item.Amount = input.Data.Amount;
            item.Currency = FleetValidation.Currency(input.Data.Currency);
        }
        if (input.Data.ReceiptNumber is not null || input.Data.Amount is not null)
            item.ReceiptNumber = FleetValidation.Text(input.Data.ReceiptNumber, 100, "Bizonylatszám");
        item.IsFullTank = input.Data.IsFullTank;
        item.Version++;
        item.UpdatedBy = Actor;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        var after = FuelRow(item);
        Audit("vehicle.fuel_updated", entryId, before, new { Data = after, Reason = reason }, id);
        await db.SaveChangesAsync(ct);
        return after;
    }, ct);

    public Task<bool> VoidFuel(Guid id, Guid entryId, string? reason, CancellationToken ct) => Scoped(Permissions.FuelManage, async access =>
    {
        await Car(id, access, Permissions.FuelManage, ct, write: true);
        var item = await db.VehicleFuelEntries.SingleOrDefaultAsync(x => x.VehicleId == id && x.Id == entryId, ct)
            ?? throw Error(404, "fuel_not_found", "A tankolás nem található.");
        if (item.VoidedAt is not null) return true;
        var why = FleetValidation.Text(reason, 500, "Indoklás", required: true);
        item.VoidedAt = DateTimeOffset.UtcNow;
        item.Version++;
        item.UpdatedBy = Actor;
        item.UpdatedAt = item.VoidedAt;
        Audit("vehicle.fuel_voided", entryId, null, new { item.VoidedAt, Reason = why }, id);
        await db.SaveChangesAsync(ct);
        return true;
    }, ct);

    public Task<PageResult<HandoverRow>> Handovers(Guid id, int page, CancellationToken ct) => Scoped(Permissions.VehiclesRead, async access =>
    {
        await Car(id, access, Permissions.VehiclesRead, ct);
        FleetValidation.Page(page);
        var query = db.VehicleHandovers.AsNoTracking().Where(x => x.VehicleId == id);
        var rows = await query.OrderByDescending(x => x.RecordedAt).ThenByDescending(x => x.Id).Skip((page - 1) * 25).Take(25)
            .Select(x => new HandoverRow(x.Id, x.PreviousUserId, x.NextUserId, x.RecordedBy, x.RecordedAt, x.Kilometers, x.Condition, x.Notes, x.Photo != null)).ToArrayAsync(ct);
        return new PageResult<HandoverRow>(rows, await query.CountAsync(ct), page, 25);
    }, ct);

    public Task<HandoverRow> Handover(Guid id, HandoverInput input, byte[]? photo, CancellationToken ct) => Scoped(Permissions.VehiclesAssignUsers, async access =>
    {
        var car = await Car(id, access, Permissions.VehiclesAssignUsers, ct, write: true);
        await Car(id, access, Permissions.OdometerCreate, ct);
        FleetValidation.Revision(car.Version, input.Version);
        FleetValidation.Range(input.Kilometers, 100_000_000, "Kilométerállás");
        if (input.Kilometers < car.OdometerKm) throw FleetValidation.Invalid("A kilométerállás nem lehet kisebb az előzőnél.");
        var previous = await db.VehicleUserAssignments.Where(x => x.VehicleId == id && x.ReleasedAt == null).Select(x => x.UserId).SingleOrDefaultAsync(ct);
        if (previous == input.UserId) throw FleetValidation.Invalid("Az átvevőnek különböznie kell a jelenlegi használótól.");
        var now = DateTimeOffset.UtcNow;
        await ChangeAssignee(car, input.UserId, now, ct);
        var item = new VehicleHandover
        {
            TenantId = TenantId, VehicleId = id, PreviousUserId = previous, NextUserId = input.UserId, RecordedBy = Actor, RecordedAt = now,
            Kilometers = input.Kilometers, Condition = FleetValidation.Text(input.Condition, 200, "Állapot", required: true)!,
            Notes = FleetValidation.Text(input.Notes, 1000, "Megjegyzés"), Photo = photo
        };
        db.VehicleHandovers.Add(item);
        db.OdometerReadings.Add(new() { TenantId = TenantId, VehicleId = id, Kilometers = item.Kilometers, RecordedBy = Actor, RecordedAt = now });
        car.OdometerKm = item.Kilometers;
        var row = new HandoverRow(item.Id, previous, input.UserId, Actor, now, item.Kilometers, item.Condition, item.Notes, photo is not null);
        Audit("vehicle.handover", item.Id, null, row, id);
        await db.SaveChangesAsync(ct);
        return row;
    }, ct);

    public Task<byte[]> OperationImage(Guid carId, Guid id, bool fuel, CancellationToken ct)
    {
        var permission = fuel ? Permissions.FuelRead : Permissions.VehiclesRead;
        return Scoped(permission, async access =>
        {
            await Car(carId, access, permission, ct);
            var bytes = fuel
                ? await db.VehicleFuelEntries.Where(x => x.VehicleId == carId && x.Id == id).Select(x => x.Receipt).SingleOrDefaultAsync(ct)
                : await db.VehicleHandovers.Where(x => x.VehicleId == carId && x.Id == id).Select(x => x.Photo).SingleOrDefaultAsync(ct);
            return bytes ?? throw Error(404, "photo_not_found", "A fénykép nem található.");
        }, ct);
    }

    public Task<bool> CheckOperationUpload(Guid id, bool fuel, CancellationToken ct)
    {
        var permission = fuel ? Permissions.FuelManage : Permissions.VehiclesAssignUsers;
        return Scoped(permission, async access =>
        {
            await Car(id, access, permission, ct, write: true);
            if (!fuel) await Car(id, access, Permissions.OdometerCreate, ct);
            return true;
        }, ct);
    }
}
