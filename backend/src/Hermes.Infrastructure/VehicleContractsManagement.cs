using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    private static LeaseDetails LeaseDto(VehicleLease x, string partnerName) => new(x.Id, partnerName,
        new(x.PartnerId, x.ContractNumber, x.StartDate, x.EndDate, x.PaymentAmount, x.Currency, x.BillingFrequency, x.AnnualKmLimit, x.TotalKmLimit,
            x.Status, x.DocumentUrl, x.Notes, x.Version), x.CreatedAt, x.CreatedBy, x.UpdatedAt, x.UpdatedBy);
    public Task<PageResult<LeaseDetails>> Leases(Guid vehicleId, int page, CancellationToken ct) => Scoped(Permissions.LeasingRead, async access =>
    {
        await Car(vehicleId, access, Permissions.LeasingRead, ct); FleetValidation.Page(page);
        var q = db.VehicleLeases.AsNoTracking().Where(x => x.VehicleId == vehicleId);
        var rows = await (from x in q join p in db.Partners on x.PartnerId equals p.Id orderby x.StartDate descending, x.Id descending
            select new { Lease = x, p.Name }).Skip((page - 1) * 25).Take(25).ToArrayAsync(ct);
        return new PageResult<LeaseDetails>(rows.Select(x => LeaseDto(x.Lease, x.Name)).ToArray(), await q.CountAsync(ct), page, 25);
    }, ct);
    public Task<LeaseDetails> SaveLease(Guid vehicleId, Guid? id, LeaseInput input, CancellationToken ct) => Scoped(Permissions.LeasingManage, async access =>
    {
        var car = await Car(vehicleId, access, Permissions.LeasingManage, ct, write: true); var data = FleetValidation.Lease(input);
        var x = id is { } key ? await db.VehicleLeases.SingleOrDefaultAsync(x => x.Id == key && x.VehicleId == vehicleId, ct)
            ?? throw Error(404, "lease_not_found", "A szerződés nem található ennél a járműnél.")
            : new VehicleLease { TenantId = TenantId, VehicleId = vehicleId, ContractNumber = data.ContractNumber, CreatedBy = Actor };
        if (id is not null) FleetValidation.Revision(x.Version, data.Version);
        var partner = await EligiblePartner(data.PartnerId, true, id is not null && data.PartnerId == x.PartnerId && data.Status != "Active", ct);
        var before = id is null ? null : LeaseDto(x, (await Partner(x.PartnerId, ct)).Name);
        if (data.Status == "Active")
        {
            var profile = await Profile(vehicleId, ct);
            if (profile.Ownership is not ("Leased" or "Rented")) throw Error(409, "ownership_required", "Aktív szerződéshez a jármű tulajdonlása lízingelt vagy bérelt legyen.");
            if (await db.VehicleLeases.AnyAsync(y => y.VehicleId == vehicleId && y.Id != x.Id && y.Status == "Active" && y.StartDate <= data.EndDate && y.EndDate >= data.StartDate, ct))
                throw Error(409, "overlapping_lease", "A járműnek erre az időszakra már van aktív szerződése.");
        }
        if (id is null) db.VehicleLeases.Add(x); else { x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor; }
        x.PartnerId = data.PartnerId; x.ContractNumber = data.ContractNumber; x.StartDate = data.StartDate; x.EndDate = data.EndDate;
        x.PaymentAmount = data.PaymentAmount; x.Currency = data.Currency; x.BillingFrequency = data.BillingFrequency;
        x.AnnualKmLimit = data.AnnualKmLimit; x.TotalKmLimit = data.TotalKmLimit; x.Status = data.Status; x.DocumentUrl = data.DocumentUrl; x.Notes = data.Notes;
        car.Version++; var after = LeaseDto(x, partner.Name);
        Audit(id is null ? "vehicle.lease_created" : "vehicle.lease_updated", x.Id, before, after, vehicleId); await db.SaveChangesAsync(ct); return after;
    }, ct);
    private static ServiceDetails ServiceDto(VehicleService x, string partnerName) => new(x.Id, partnerName,
        new(x.PartnerId, x.PerformedOn, x.Kilometers, x.Description, x.WorkOrderNumber, x.Cost, x.Currency, x.NextServiceDate, x.NextServiceKm, x.DocumentUrl, x.Notes, x.Version),
        x.IsVoided, x.VoidReason, x.CreatedAt, x.CreatedBy, x.UpdatedAt, x.UpdatedBy);
    public Task<PageResult<ServiceDetails>> Services(Guid vehicleId, int page, bool includeVoided, CancellationToken ct) => Scoped(Permissions.ServicesRead, async access =>
    {
        await Car(vehicleId, access, Permissions.ServicesRead, ct); FleetValidation.Page(page);
        var q = db.VehicleServices.AsNoTracking().Where(x => x.VehicleId == vehicleId && (includeVoided || !x.IsVoided));
        var rows = await (from x in q join p in db.Partners on x.PartnerId equals p.Id orderby x.PerformedOn descending, x.Id descending
            select new { Service = x, p.Name }).Skip((page - 1) * 25).Take(25).ToArrayAsync(ct);
        return new PageResult<ServiceDetails>(rows.Select(x => ServiceDto(x.Service, x.Name)).ToArray(), await q.CountAsync(ct), page, 25);
    }, ct);
    public Task<ServiceDetails> SaveService(Guid vehicleId, Guid? id, ServiceInput input, CancellationToken ct) => Scoped(Permissions.ServicesManage, async access =>
    {
        var car = await Car(vehicleId, access, Permissions.ServicesManage, ct, write: true); var data = FleetValidation.Service(input);
        var x = id is { } key ? await db.VehicleServices.SingleOrDefaultAsync(x => x.Id == key && x.VehicleId == vehicleId, ct)
            ?? throw Error(404, "service_not_found", "A szervizbejegyzés nem található ennél a járműnél.")
            : new VehicleService { TenantId = TenantId, VehicleId = vehicleId, Description = data.Description, CreatedBy = Actor };
        if (id is not null) { FleetValidation.Revision(x.Version, data.Version); if (x.IsVoided) throw Error(409, "service_voided", "Az érvénytelenített bejegyzés nem szerkeszthető. Rögzíts új bejegyzést."); }
        var partner = await EligiblePartner(data.PartnerId, false, id is not null && data.PartnerId == x.PartnerId, ct);
        var before = id is null ? null : ServiceDto(x, (await Partner(x.PartnerId, ct)).Name);
        if (id is null) db.VehicleServices.Add(x); else { x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor; }
        x.PartnerId = data.PartnerId; x.PerformedOn = data.PerformedOn; x.Kilometers = data.Kilometers; x.Description = data.Description;
        x.WorkOrderNumber = data.WorkOrderNumber; x.Cost = data.Cost; x.Currency = data.Currency; x.NextServiceDate = data.NextServiceDate;
        x.NextServiceKm = data.NextServiceKm; x.DocumentUrl = data.DocumentUrl; x.Notes = data.Notes;
        // A historical service reading is independent of the current, monotonic odometer stream.
        car.Version++; var after = ServiceDto(x, partner.Name);
        Audit(id is null ? "vehicle.service_created" : "vehicle.service_updated", x.Id, before, after, vehicleId); await db.SaveChangesAsync(ct); return after;
    }, ct);
    public Task<ServiceDetails> VoidService(Guid vehicleId, Guid id, VersionReason input, CancellationToken ct) => Scoped(Permissions.ServicesManage, async access =>
    {
        var car = await Car(vehicleId, access, Permissions.ServicesManage, ct, write: true);
        var x = await db.VehicleServices.SingleOrDefaultAsync(x => x.Id == id && x.VehicleId == vehicleId, ct) ?? throw Error(404, "service_not_found", "A szervizbejegyzés nem található.");
        FleetValidation.Revision(x.Version, input.Version); var reason = OrganizationValidation.Reason(input.Reason);
        var partner = await Partner(x.PartnerId, ct); var before = ServiceDto(x, partner.Name);
        if (x.IsVoided) return before;
        x.IsVoided = true; x.VoidReason = reason; x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor; car.Version++;
        var after = ServiceDto(x, partner.Name); Audit("vehicle.service_voided", x.Id, before, after, vehicleId); await db.SaveChangesAsync(ct); return after;
    }, ct);
}
