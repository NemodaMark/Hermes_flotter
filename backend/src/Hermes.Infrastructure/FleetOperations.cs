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
        var rows = await db.VehicleFuelEntries.AsNoTracking().Where(x => x.VehicleId == id && x.FueledOn >= month && x.FueledOn < next)
            .OrderByDescending(x => x.FueledOn).ThenByDescending(x => x.Id)
            .Select(x => new FuelEntryRow(x.Id, x.FueledOn, x.Kilometers, x.Liters, x.Amount, x.Currency, x.Receipt != null, x.VoidedAt != null)).ToArrayAsync(ct);
        return new FuelMonth(rows, rows.Where(x => !x.IsVoided).GroupBy(x => x.Currency).OrderBy(x => x.Key)
            .Select(x => new FuelTotal(x.Key, x.Sum(y => y.Liters), x.Sum(y => y.Amount))).ToArray());
    }, ct);

    public Task<FuelEntryRow> RecordFuel(Guid id, FuelEntryInput input, byte[]? receipt, CancellationToken ct) => Scoped(Permissions.FuelManage, async access =>
    {
        await Car(id, access, Permissions.FuelManage, ct, write: true);
        FleetValidation.Date(input.FueledOn);
        if (input.FueledOn > await CompanyToday(ct)) throw FleetValidation.Invalid("A tankolás dátuma nem lehet jövőbeli.");
        FleetValidation.Range(input.Kilometers, 100_000_000, "Kilométerállás");
        FleetValidation.Range(input.Liters, 999_999, "Liter", 3);
        FleetValidation.Range(input.Amount, 999_999_999_999.99m, "Összeg", 2);
        if (input.Liters == 0) throw FleetValidation.Invalid("Adj meg pozitív mennyiséget.");
        var currency = FleetValidation.Currency(input.Currency);
        var item = new VehicleFuelEntry
        {
            TenantId = TenantId, VehicleId = id, FueledOn = input.FueledOn, Kilometers = input.Kilometers, Liters = input.Liters,
            Amount = input.Amount, Currency = currency, RecordedBy = Actor, Receipt = receipt
        };
        db.VehicleFuelEntries.Add(item);
        var row = new FuelEntryRow(item.Id, item.FueledOn, item.Kilometers, item.Liters, item.Amount, currency, receipt is not null, false);
        Audit("vehicle.fuel_recorded", item.Id, null, row, id);
        await db.SaveChangesAsync(ct);
        return row;
    }, ct);

    public Task<bool> VoidFuel(Guid id, Guid entryId, string? reason, CancellationToken ct) => Scoped(Permissions.FuelManage, async access =>
    {
        await Car(id, access, Permissions.FuelManage, ct, write: true);
        var item = await db.VehicleFuelEntries.SingleOrDefaultAsync(x => x.VehicleId == id && x.Id == entryId, ct)
            ?? throw Error(404, "fuel_not_found", "A tankolás nem található.");
        if (item.VoidedAt is not null) return true;
        var why = FleetValidation.Text(reason, 500, "Indoklás", required: true);
        item.VoidedAt = DateTimeOffset.UtcNow;
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
