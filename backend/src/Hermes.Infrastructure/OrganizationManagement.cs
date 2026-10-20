using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class OrganizationManagement(HermesDbContext db, TenantContext context, ITenantDirectory directory)
{
    private Guid TenantId => context.TenantId ?? throw new InvalidOperationException("Company context is required.");
    private string Actor => context.UserSubject!;
    private static ManagementException Error(int status, string code, string message) => UserAccounts.Error(status, code, message);
    private Task<T> Scoped<T>(string permission, bool write, Func<Task<T>> action, CancellationToken ct, bool changeStatus = false)
        => TenantTransaction.RunAsync(db, TenantId, async () =>
        {
            await UserAccounts.LockSystemAccess(db, ct, shared: true);
            await AccessRules.LockTenant(db, TenantId, ct, allowInactive: true);
            await AccessRules.Authorize(db, TenantId, Actor, permission, ct, allowInactive: true);
            if (write && !changeStatus && await db.ArchivedTenants.AnyAsync(x => x.TenantId == TenantId, ct))
                throw Error(409, "company_inactive", "A módosításhoz előbb állítsd vissza a céget aktív állapotba.");
            return await action();
        }, ct);

    private void Audit(string action, Guid entityId, object? before, object? after)
    {
        var details = new { entityId, before, after };
        db.AccessAuditEvents.Add(new() { TenantId = TenantId, ActorSubject = Actor, Action = action, Details = JsonSerializer.Serialize(details) });
        UserAccounts.Audit(db, Actor, null, action, details, TenantId);
    }
    private static bool HasOrganizationAccess(TenantSummary x) => x.Permissions.Any(p => p.StartsWith("companies.", StringComparison.Ordinal)
        || p.StartsWith("sites.", StringComparison.Ordinal) || p == Permissions.AuditRead);

    public async Task<PageResult<CompanyRow>> List(string actor, int page, string? search, string status, CancellationToken ct)
    {
        if (page is < 1 or > 10000 || search?.Length > 100 || status is not ("Active" or "Suspended" or "Archived" or "all"))
            throw Error(400, "invalid_search", "Érvénytelen keresés, oldalszám vagy cégállapot.");
        var accessible = (await directory.ListForUserAsync(actor, ct, includeInactive: true)).Where(HasOrganizationAccess).ToArray();
        var inactive = await db.ArchivedTenants.AsNoTracking().ToDictionaryAsync(x => x.TenantId, x => x.Status, ct);
        var matches = accessible.Select(x => new CompanyRow(x.Id, x.Name, inactive.GetValueOrDefault(x.Id, "Active"), x.Permissions))
            .Where(x => (status == "all" || x.Status == status) && (string.IsNullOrWhiteSpace(search) || x.Name.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase)))
            .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id).ToArray();
        return new(matches.Skip((page - 1) * 25).Take(25).ToArray(), matches.Length, page, 25);
    }

    private async Task<CompanyProfile> Profile(CancellationToken ct)
        => await db.CompanyProfiles.SingleOrDefaultAsync(x => x.TenantId == TenantId, ct) ?? new() { TenantId = TenantId };
    private void Touch(CompanyProfile x)
    {
        if (db.Entry(x).State == EntityState.Detached) db.CompanyProfiles.Add(x);
        x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor;
    }
    private async Task<CompanyDetails> Details(CompanyProfile x, CancellationToken ct)
    {
        var company = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == TenantId, ct);
        var state = await db.ArchivedTenants.SingleOrDefaultAsync(t => t.TenantId == TenantId, ct);
        return new(TenantId, new(company.Name, x.LegalName, x.TaxNumber, x.RegistrationNumber, x.EuVatNumber,
            new(x.CountryCode, x.PostalCode, x.City, x.AddressLine1, x.AddressLine2), x.Email, x.Phone, x.Website,
            company.TimeZone, x.Currency, x.DistanceUnit, x.Version), state?.Status ?? "Active", x.StatusReason ?? state?.Reason,
            x.StatusChangedAt ?? state?.ArchivedAt, x.CreatedAt, x.CreatedBy, x.UpdatedAt, x.UpdatedBy);
    }
    public Task<CompanyDetails> Get(CancellationToken ct) => Scoped(Permissions.CompaniesRead, false, async () => await Details(await Profile(ct), ct), ct);
    public Task<CompanyState> State(CancellationToken ct) => Scoped(Permissions.CompaniesStatus, false, async () =>
    {
        var details = await Details(await Profile(ct), ct);
        return new CompanyState(details.Data.Version, details.Status, details.StatusReason, details.StatusChangedAt);
    }, ct);
    public Task<CompanyDetails> Update(CompanyInput input, CancellationToken ct) => Scoped(Permissions.CompaniesUpdate, true, async () =>
    {
        var x = OrganizationValidation.Company(input);
        var profile = await Profile(ct);
        OrganizationValidation.Revision(profile.Version, x.Version);
        var before = await Details(profile, ct);
        var company = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == TenantId, ct);
        company.Name = x.Name; company.TimeZone = x.TimeZone;
        profile.LegalName = x.LegalName; profile.TaxNumber = x.TaxNumber; profile.RegistrationNumber = x.RegistrationNumber;
        profile.EuVatNumber = x.EuVatNumber; profile.CountryCode = x.Address.CountryCode; profile.PostalCode = x.Address.PostalCode;
        profile.City = x.Address.City; profile.AddressLine1 = x.Address.AddressLine1; profile.AddressLine2 = x.Address.AddressLine2;
        profile.Email = x.Email; profile.Phone = x.Phone; profile.Website = x.Website;
        profile.Currency = x.Currency; profile.DistanceUnit = x.DistanceUnit; Touch(profile);
        // Save the name before re-reading the DTO, within the same transaction as its audit.
        await db.SaveChangesAsync(ct);
        var after = await Details(profile, ct);
        Audit("company.updated", TenantId, before, after);
        await db.SaveChangesAsync(ct);
        return after;
    }, ct);
    public Task<CompanyState> Status(ChangeCompanyStatus input, CancellationToken ct) => Scoped(Permissions.CompaniesStatus, true, async () =>
    {
        if (input.Status is not ("Active" or "Suspended" or "Archived")) throw Error(400, "invalid_status", "Ismeretlen cégállapot.");
        var reason = OrganizationValidation.Reason(input.Reason);
        var profile = await Profile(ct); OrganizationValidation.Revision(profile.Version, input.Version);
        var before = await Details(profile, ct);
        if (before.Status == input.Status) return new CompanyState(before.Data.Version, before.Status, before.StatusReason, before.StatusChangedAt);
        var state = await db.ArchivedTenants.SingleOrDefaultAsync(x => x.TenantId == TenantId, ct);
        if (input.Status == "Active") { if (state is not null) db.ArchivedTenants.Remove(state); }
        else if (state is null) db.ArchivedTenants.Add(new() { TenantId = TenantId, Status = input.Status, Reason = reason });
        else { state.Status = input.Status; state.Reason = reason; state.ArchivedAt = DateTimeOffset.UtcNow; }
        profile.StatusReason = reason; profile.StatusChangedAt = DateTimeOffset.UtcNow;
        Touch(profile);
        await db.SaveChangesAsync(ct);
        var after = await Details(profile, ct);
        Audit("company.status_changed", TenantId, before, new { company = after, reason });
        await db.SaveChangesAsync(ct);
        return new CompanyState(after.Data.Version, after.Status, after.StatusReason, after.StatusChangedAt);
    }, ct, changeStatus: true);

    private static ContactDetails ContactDto(CompanyContact x) => new(x.Id, new(x.Name, x.Position, x.Email, x.Phone, x.Version),
        x.IsArchived, x.StatusReason, x.ArchivedAt, x.CreatedAt, x.CreatedBy, x.UpdatedAt, x.UpdatedBy);
    private async Task<CompanyContact> Contact(Guid id, CancellationToken ct) => await db.CompanyContacts.SingleOrDefaultAsync(x => x.Id == id, ct)
        ?? throw Error(404, "contact_not_found", "A kapcsolattartó nem található ennél a cégnél.");
    public Task<ContactDetails[]> Contacts(bool includeArchived, CancellationToken ct) => Scoped(Permissions.CompaniesRead, false, async () =>
        (await db.CompanyContacts.AsNoTracking().Where(x => includeArchived || !x.IsArchived).OrderBy(x => x.Name).ToArrayAsync(ct)).Select(ContactDto).ToArray(), ct);
    public Task<ContactDetails> SaveContact(Guid? id, ContactInput input, CancellationToken ct) => Scoped(Permissions.CompaniesUpdate, true, async () =>
    {
        var data = OrganizationValidation.Contact(input);
        var x = id is { } key ? await Contact(key, ct) : new() { TenantId = TenantId, Name = data.Name, CreatedBy = Actor };
        var before = id is null ? null : ContactDto(x);
        if (id is not null) { OrganizationValidation.Revision(x.Version, data.Version); if (x.IsArchived) throw Error(409, "contact_archived", "Előbb állítsd vissza a kapcsolattartót."); }
        else db.CompanyContacts.Add(x);
        x.Name = data.Name; x.Position = data.Position; x.Email = data.Email; x.Phone = data.Phone;
        if (id is not null) { x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor; }
        var result = ContactDto(x); Audit(id is null ? "contact.created" : "contact.updated", x.Id, before, result);
        await db.SaveChangesAsync(ct); return result;
    }, ct);
    public Task<ContactDetails> ContactStatus(Guid id, ChangeArchiveStatus input, CancellationToken ct) => Scoped(Permissions.CompaniesUpdate, true, async () =>
    {
        if (input.IsArchived is null) throw Error(400, "missing_status", "Add meg az archiválás állapotát.");
        var reason = OrganizationValidation.Reason(input.Reason);
        var x = await Contact(id, ct); OrganizationValidation.Revision(x.Version, input.Version);
        if (input.IsArchived.Value && await db.Sites.AnyAsync(s => s.ContactId == id && !s.IsArchived, ct))
            throw Error(409, "contact_in_use", "A kapcsolattartó aktív telephelyhez tartozik. Előbb módosítsd a telephely kapcsolattartóját.");
        var before = ContactDto(x); x.IsArchived = input.IsArchived.Value; x.ArchivedAt = x.IsArchived ? DateTimeOffset.UtcNow : null;
        x.StatusReason = reason; x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor;
        var after = ContactDto(x); Audit("contact.status_changed", id, before, after); await db.SaveChangesAsync(ct); return after;
    }, ct);

    private async Task<Site> Site(Guid id, CancellationToken ct) => await db.Sites.SingleOrDefaultAsync(x => x.Id == id, ct)
        ?? throw Error(404, "site_not_found", "A telephely nem található ennél a cégnél.");
    private async Task<SiteDetails> SiteDto(Site x, CancellationToken ct) => new(x.Id, new(x.Name, x.Code,
        new(x.CountryCode, x.PostalCode, x.City, x.AddressLine1, x.AddressLine2), x.Email, x.Phone, x.ContactId, x.Version),
        x.ContactId is { } id ? await db.CompanyContacts.Where(c => c.Id == id).Select(c => c.Name).SingleOrDefaultAsync(ct) : null,
        x.IsArchived, x.StatusReason, x.ArchivedAt, await db.VehicleSiteAssignments.CountAsync(a => a.SiteId == x.Id, ct),
        x.CreatedAt, x.CreatedBy, x.UpdatedAt, x.UpdatedBy);
    public Task<SiteDetails[]> Sites(bool includeArchived, CancellationToken ct) => Scoped(Permissions.SitesRead, false, async () =>
    {
        var result = new List<SiteDetails>();
        foreach (var site in await db.Sites.AsNoTracking().Where(x => includeArchived || !x.IsArchived).OrderBy(x => x.Name).ToArrayAsync(ct)) result.Add(await SiteDto(site, ct));
        return result.ToArray();
    }, ct);
    public Task<SiteDetails> SaveSite(Guid? id, SiteInput input, CancellationToken ct) => Scoped(id is null ? Permissions.SitesCreate : Permissions.SitesUpdate, true, async () =>
    {
        var data = OrganizationValidation.Site(input);
        var code = data.Code.ToUpperInvariant();
        if (await db.Sites.AnyAsync(x => x.NormalizedCode == code && x.Id != id, ct)) throw Error(409, "site_code_exists", "Ez a telephelykód ennél a cégnél már foglalt, az archivált telephelyeket is beleértve.");
        if (data.ContactId is { } contact && (await Contact(contact, ct)).IsArchived) throw Error(400, "contact_archived", "Aktív kapcsolattartót válassz.");
        var x = id is { } key ? await Site(key, ct) : new() { TenantId = TenantId, Name = data.Name, Code = data.Code, NormalizedCode = code, CreatedBy = Actor };
        var before = id is null ? null : await SiteDto(x, ct);
        if (id is not null) { OrganizationValidation.Revision(x.Version, data.Version); if (x.IsArchived) throw Error(409, "site_archived", "Előbb állítsd vissza a telephelyet."); }
        else db.Sites.Add(x);
        x.Name = data.Name; x.Code = data.Code; x.NormalizedCode = code;
        x.CountryCode = data.Address.CountryCode; x.PostalCode = data.Address.PostalCode; x.City = data.Address.City;
        x.AddressLine1 = data.Address.AddressLine1; x.AddressLine2 = data.Address.AddressLine2;
        x.Email = data.Email; x.Phone = data.Phone; x.ContactId = data.ContactId;
        if (id is not null) { x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor; }
        var result = await SiteDto(x, ct); Audit(id is null ? "site.created" : "site.updated", x.Id, before, result);
        await db.SaveChangesAsync(ct); return result;
    }, ct);
    public Task<SiteDetails> SiteStatus(Guid id, ChangeArchiveStatus input, CancellationToken ct) => Scoped(Permissions.SitesArchive, true, async () =>
    {
        if (input.IsArchived is null) throw Error(400, "missing_status", "Add meg az archiválás állapotát.");
        var reason = OrganizationValidation.Reason(input.Reason);
        var x = await Site(id, ct); OrganizationValidation.Revision(x.Version, input.Version);
        if (!input.IsArchived.Value && x.ContactId is { } contactId && (await Contact(contactId, ct)).IsArchived)
            throw Error(409, "contact_archived", "A visszaállításhoz előbb aktiváld a telephely kapcsolattartóját.");
        if (input.IsArchived.Value && await db.VehicleSiteAssignments.AnyAsync(v => v.SiteId == id, ct))
            throw Error(409, "site_has_vehicles", "Előbb rendeld át a telephely járműveit, vagy szüntesd meg a hozzárendelésüket.");
        var before = await SiteDto(x, ct); x.IsArchived = input.IsArchived.Value; x.ArchivedAt = x.IsArchived ? DateTimeOffset.UtcNow : null;
        x.StatusReason = reason; x.Version++; x.UpdatedAt = DateTimeOffset.UtcNow; x.UpdatedBy = Actor;
        var result = await SiteDto(x, ct); Audit("site.status_changed", id, before, result); await db.SaveChangesAsync(ct); return result;
    }, ct);

    public Task<SiteVehicle[]> Vehicles(CancellationToken ct) => Scoped(Permissions.SitesRead, false, async () =>
    {
        await AccessRules.Authorize(db, TenantId, Actor, Permissions.VehiclesRead, ct, allowInactive: true);
        return await (from vehicle in db.Vehicles.AsNoTracking()
            join assignment in db.VehicleSiteAssignments on vehicle.Id equals assignment.VehicleId into assignments
            from assignment in assignments.DefaultIfEmpty()
            join site in db.Sites on assignment.SiteId equals site.Id into sites
            from site in sites.DefaultIfEmpty()
            orderby vehicle.Registration
            select new SiteVehicle(vehicle.Id, vehicle.Registration, vehicle.Make, vehicle.Model, (Guid?)assignment.SiteId, site.Name, vehicle.Version)).ToArrayAsync(ct);
    }, ct);
    public Task<SiteVehicle> Assign(Guid vehicleId, AssignVehicleSite input, CancellationToken ct) => Scoped(Permissions.SitesAssignVehicles, true, async () =>
    {
        await AccessRules.Authorize(db, TenantId, Actor, Permissions.VehiclesRead, ct);
        var vehicle = await db.Vehicles.SingleOrDefaultAsync(x => x.Id == vehicleId, ct) ?? throw Error(404, "vehicle_not_found", "A jármű nem található ennél a cégnél.");
        OrganizationValidation.Revision(vehicle.Version, input.Version);
        var target = input.SiteId is { } id ? await Site(id, ct) : null;
        if (target?.IsArchived == true) throw Error(409, "site_archived", "Archivált telephelyhez nem rendelhetsz járművet.");
        var assignment = await db.VehicleSiteAssignments.SingleOrDefaultAsync(x => x.VehicleId == vehicleId, ct);
        var previousSite = assignment is null ? null : await db.Sites.Where(x => x.Id == assignment.SiteId).Select(x => x.Name).SingleOrDefaultAsync(ct);
        var before = new SiteVehicle(vehicle.Id, vehicle.Registration, vehicle.Make, vehicle.Model, assignment?.SiteId, previousSite, vehicle.Version);
        if (target is null) { if (assignment is not null) db.VehicleSiteAssignments.Remove(assignment); }
        else if (assignment is null) db.VehicleSiteAssignments.Add(new() { TenantId = TenantId, VehicleId = vehicleId, SiteId = target.Id });
        else assignment.SiteId = target.Id;
        vehicle.Version++;
        var result = new SiteVehicle(vehicle.Id, vehicle.Registration, vehicle.Make, vehicle.Model, target?.Id, target?.Name, vehicle.Version);
        Audit("site.vehicle_assigned", vehicleId, before, result); await db.SaveChangesAsync(ct); return result;
    }, ct);
    public Task<PageResult<AuditSummary>> History(int page, CancellationToken ct) => Scoped(Permissions.AuditRead, false, async () =>
    {
        if (page is < 1 or > 10000) throw Error(400, "invalid_page", "Érvénytelen oldalszám.");
        var query = db.AccessAuditEvents.AsNoTracking().Where(x => x.Action.StartsWith("company.") || x.Action.StartsWith("site.") || x.Action.StartsWith("contact."));
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * 25).Take(25)
            .Select(x => new AuditSummary(x.Id, x.ActorSubject, x.Action, x.TargetSubject, x.Details, x.CreatedAt)).ToArrayAsync(ct);
        var names = await IdentityHistory.Resolve(db, rows.SelectMany(x => new[] { x.ActorSubject, x.TargetSubject }), ct);
        return new PageResult<AuditSummary>(rows.Select(x => x with
        {
            ActorSubject = IdentityHistory.Subject(names, x.ActorSubject),
            TargetSubject = x.TargetSubject is null ? null : IdentityHistory.Subject(names, x.TargetSubject),
            OriginalActorSubject = names.TryGetValue(x.ActorSubject, out var actor) && actor != x.ActorSubject ? x.ActorSubject : null,
            OriginalTargetSubject = x.TargetSubject is { } target && names.TryGetValue(target, out var name) && name != target ? target : null
        }).ToArray(), total, page, 25);
    }, ct);
}
