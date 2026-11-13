using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class FleetReminders(HermesDbContext db)
{
    public Task<Guid[]> Companies(CancellationToken ct) => db.Tenants.Select(t => t.Id).OrderBy(id => id).ToArrayAsync(ct);

    public Task<ReminderCandidate[]> Claim(Guid company, DateTimeOffset now, CancellationToken ct) => TenantTransaction.RunAsync(db, company, async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, company, ct);
        var tenant = await db.Tenants.SingleAsync(x => x.Id == company, ct);
        var today = FleetManagement.LocalDay(now, tenant.TimeZone);
        var members = (await db.Memberships.AsNoTracking().WithAccess().Where(x => x.TenantId == company && x.IsActive).ToArrayAsync(ct))
            .Where(x => x.HasCompanyAccess).ToDictionary(x => x.UserSubject, x => new ResourceAccess(x));
        var memberIds = members.Keys.ToArray();
        var recipients = await db.Users.AsNoTracking().Where(x => memberIds.Contains(x.Id) && x.EmailConfirmed && x.Email != null
            && !db.AccountLifecycles.Any(a => a.UserId == x.Id && a.IsArchived))
            .Select(x => new { x.Id, Email = x.Email! }).ToDictionaryAsync(x => x.Id, x => x.Email, ct);
        var cars = await (from v in db.Vehicles.AsNoTracking()
            join profile in db.VehicleProfiles on v.Id equals profile.VehicleId into profiles from p in profiles.DefaultIfEmpty()
            join appointment in db.VehicleServiceAppointments on v.Id equals appointment.VehicleId into appointments from ap in appointments.DefaultIfEmpty()
            join site in db.VehicleSiteAssignments on v.Id equals site.VehicleId into sites from s in sites.DefaultIfEmpty()
            join assignee in db.VehicleUserAssignments.Where(x => x.ReleasedAt == null) on v.Id equals assignee.VehicleId into assignees from a in assignees.DefaultIfEmpty()
            where v.Status == VehicleStatus.Active || v.Status == VehicleStatus.Maintenance
            select new { v.Id, v.Registration, v.OdometerKm, Site = (Guid?)s.SiteId, Assignee = (string?)a.UserId,
                Inspection = p == null ? null : p.InspectionDueDate, Insurance = p == null ? null : p.InsuranceDueDate,
                ServiceDate = p == null ? null : p.NextServiceDate, ServiceKm = p == null ? null : p.NextServiceKm,
                Appointment = (DateTimeOffset?)ap.StartsAt }).ToArrayAsync(ct);
        var claimed = new List<ReminderCandidate>();
        foreach (var car in cars)
        {
            var events = new List<(string Key, string Text, bool Service)>();
            void DateEvent(string kind, string label, DateOnly? date, int leadDays, bool service = false)
            {
                if (date is { } due && due >= today && due <= today.AddDays(leadDays))
                    events.Add(($"{kind}:{due:yyyy-MM-dd}", $"{label}: {due:yyyy.MM.dd.}", service));
            }
            DateEvent("inspection", "Műszaki vizsga lejárata", car.Inspection, 30);
            DateEvent("insurance", "Biztosítás lejárata", car.Insurance, 30);
            DateEvent("service", "Következő szerviz", car.ServiceDate, 30, service: true);
            if (car.ServiceKm is { } km && car.OdometerKm is { } current && km - current <= 1000)
                events.Add(($"service-km:{km}", $"Szerviz kilométerhatára: {km} km. Rögzített állás: {current} km.", true));
            if (car.Appointment is { } appointment && appointment >= now && appointment <= now.AddDays(7))
            {
                var local = TimeZoneInfo.ConvertTime(appointment, TimeZoneInfo.FindSystemTimeZoneById(tenant.TimeZone));
                events.Add(($"appointment:{appointment.ToUnixTimeSeconds()}", $"Egyeztetett szervizidőpont: {local:yyyy.MM.dd. HH:mm} ({tenant.TimeZone}).", true));
            }
            if (events.Count == 0) continue;
            var keys = events.Select(x => x.Key).ToArray();
            var deliveries = (await db.VehicleReminderDeliveries.Where(x => x.VehicleId == car.Id && keys.Contains(x.EventKey)).ToArrayAsync(ct))
                .ToDictionary(x => (x.UserId, x.EventKey));
            foreach (var (userId, email) in recipients)
            {
                var access = members[userId];
                if (!access.Allows(Permissions.VehiclesRead, car.Site)) continue;
                foreach (var (key, message, service) in events)
                {
                    var manager = service ? Permissions.ServicesManage : Permissions.VehiclesUpdate;
                    if (userId != car.Assignee && !access.Allows(manager, car.Site)) continue;
                    if (service && !access.Allows(Permissions.ServicesRead, car.Site)) continue;
                    if (deliveries.TryGetValue((userId, key), out var state))
                    {
                        if (state.Delivered || state.RetryAfter > now) continue;
                    }
                    else
                    {
                        state = new() { TenantId = company, VehicleId = car.Id, UserId = userId, EventKey = key };
                        db.VehicleReminderDeliveries.Add(state);
                    }
                    state.RetryAfter = now.AddMinutes(30);
                    claimed.Add(new(car.Id, userId, key, email, car.Registration, tenant.Name, message, service));
                    if (claimed.Count == 20) break;
                }
                if (claimed.Count == 20) break;
            }
            if (claimed.Count == 20) break;
        }
        await db.SaveChangesAsync(ct);
        return claimed.ToArray();
    }, ct);

    public Task<bool> CanDeliver(Guid company, ReminderCandidate item, CancellationToken ct) => TenantTransaction.RunAsync(db, company, async () =>
    {
        await UserAccounts.LockSystemAccess(db, ct, shared: true);
        await AccessRules.LockTenant(db, company, ct);
        var membership = await db.Memberships.AsNoTracking().WithAccess()
            .SingleOrDefaultAsync(x => x.TenantId == company && x.UserSubject == item.UserId && x.IsActive, ct);
        if (membership?.HasCompanyAccess != true) return false;
        var access = new ResourceAccess(membership);
        var car = await (from v in db.Vehicles.AsNoTracking()
            join a in db.VehicleSiteAssignments on v.Id equals a.VehicleId into assignments from site in assignments.DefaultIfEmpty()
            where v.Id == item.VehicleId && (v.Status == VehicleStatus.Active || v.Status == VehicleStatus.Maintenance)
            select new { Site = (Guid?)site.SiteId }).SingleOrDefaultAsync(ct);
        if (car is null || !access.Allows(Permissions.VehiclesRead, car.Site)
            || item.Service && !access.Allows(Permissions.ServicesRead, car.Site)) return false;
        var manager = item.Service ? Permissions.ServicesManage : Permissions.VehiclesUpdate;
        if (!access.Allows(manager, car.Site) && !await db.VehicleUserAssignments.AnyAsync(x =>
            x.VehicleId == item.VehicleId && x.UserId == item.UserId && x.ReleasedAt == null, ct)) return false;
        return await db.Users.AnyAsync(u => u.Id == item.UserId && u.EmailConfirmed && u.Email == item.Email
            && !db.AccountLifecycles.Any(a => a.UserId == u.Id && a.IsArchived), ct);
    }, ct);

    public Task<bool> MarkDelivered(Guid company, ReminderCandidate item, CancellationToken ct) => TenantTransaction.RunAsync(db, company, async () =>
        await db.VehicleReminderDeliveries.Where(x => x.VehicleId == item.VehicleId && x.UserId == item.UserId && x.EventKey == item.EventKey)
            .ExecuteUpdateAsync(set => set.SetProperty(x => x.Delivered, true), ct) == 1, ct);
}
