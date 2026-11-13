using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class DashboardManagement(HermesDbContext db, TenantContext context)
{
    public Task<DashboardSummary> Read(CancellationToken ct)
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
            // Resolve only actual assignments in this company. A system manager's virtual
            // membership must not inherit every group's preferences or vehicle scopes.
            var preferences = membership?.HasCompanyAccess == true ? membership.Groups
                .Where(x => x.Group.Companies.Any(c => c.TenantId == company)).Select(x => x.Group).ToArray() : [];
            var priority = preferences.Length == 0 ? 0 : preferences.Max(x => x.DashboardPriority);
            var winners = preferences.Where(x => x.DashboardPriority == priority).OrderBy(x => x.Id).ToArray();
            var mode = winners.Length > 0 && winners.All(x => x.DashboardMode == "Vehicle") ? "Vehicle" : "Overview";
            var source = winners.Length == 1 ? winners[0].Name : null;
            var accessMember = system ? TenantDirectory.SystemMembership(actor, company) : membership!;
            var canRead = accessMember.EffectivePermissions.Contains(Permissions.VehiclesRead);
            if (!canRead) return new DashboardSummary(mode, priority, source, false, []);
            var access = new ResourceAccess(accessMember);
            var rows = await (from v in VehicleAccess.Query(db, access, Permissions.VehiclesRead).AsNoTracking()
                join p in db.VehicleProfiles on v.Id equals p.VehicleId into profiles from p in profiles.DefaultIfEmpty()
                join ap in db.VehicleServiceAppointments on v.Id equals ap.VehicleId into appointments from appointment in appointments.DefaultIfEmpty()
                join a in db.VehicleSiteAssignments on v.Id equals a.VehicleId into assignments from a in assignments.DefaultIfEmpty()
                join s in db.Sites on a.SiteId equals s.Id into sites from s in sites.DefaultIfEmpty()
                orderby v.Registration
                select new { Car = v, Profile = p, SiteId = (Guid?)a.SiteId, SiteName = s.Name, Appointment = (DateTimeOffset?)appointment.StartsAt,
                    Mine = db.VehicleUserAssignments.Any(u => u.VehicleId == v.Id && u.UserId == actor && u.ReleasedAt == null) }).ToArrayAsync(ct);
            return new DashboardSummary(mode, priority, source, true, rows.Select(x => new DashboardVehicle(
                new VehicleSummary(x.Car.Id, x.Car.Registration, x.Car.Make, x.Car.Model, x.Car.Status.ToString())
                { Version = x.Car.Version, SiteId = x.SiteId, SiteName = x.SiteName, OdometerKm = x.Car.OdometerKm,
                    Permissions = VehicleAccess.PermissionsFor(access, x.SiteId) },
                x.Profile?.BodyType ?? "Unknown", x.Profile?.Color, x.Profile?.InspectionDueDate, x.Profile?.InsuranceDueDate,
                x.Profile?.NextServiceDate, x.Profile?.NextServiceKm, x.Mine)
                { ServiceAppointmentAt = access.Allows(Permissions.ServicesRead, x.SiteId) ? x.Appointment : null }).ToArray());
        }, ct);
    }
}
