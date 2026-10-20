using System.Text.Json;
using System.Text;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    private static PartnerDetails PartnerDto(Partner p) => new(p.Id, new(p.Name, p.IsLessor, p.IsService,
        new(p.CountryCode, p.PostalCode, p.City, p.AddressLine1, p.AddressLine2), p.Email, p.Phone, p.Website, p.Notes,
        JsonSerializer.Deserialize<PartnerContactInput[]>(p.ContactsJson)!, p.Version), p.IsArchived, p.StatusReason, p.CreatedAt, p.CreatedBy, p.UpdatedAt, p.UpdatedBy);
    private async Task<Partner> Partner(Guid id, CancellationToken ct) => await db.Partners.SingleOrDefaultAsync(x => x.Id == id, ct)
        ?? throw Error(404, "partner_not_found", "A partner nem található ennél a cégnél.");
    private async Task<Partner> EligiblePartner(Guid id, bool lessor, bool unchanged, CancellationToken ct)
    {
        var p = await Partner(id, ct);
        if (!unchanged && (p.IsArchived || (lessor ? !p.IsLessor : !p.IsService)))
            throw Error(409, "partner_ineligible", lessor ? "Válassz aktív lízingbeadó partnert." : "Válassz aktív szervizpartnert.");
        return p;
    }
    public Task<PageResult<PartnerDetails>> Partners(int page, string? search, string kind, bool includeArchived, CancellationToken ct) => Scoped(Permissions.PartnersRead, async _ =>
    {
        FleetValidation.Page(page, search); FleetValidation.Choice(kind, "Partnerkategória", "all", "lessor", "service");
        var q = db.Partners.AsNoTracking().Where(x => (includeArchived || !x.IsArchived) && (kind == "all" || kind == "lessor" && x.IsLessor || kind == "service" && x.IsService));
        if (!string.IsNullOrWhiteSpace(search)) { var term = search.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant(); q = q.Where(x => x.SearchText.Contains(term)); }
        return new PageResult<PartnerDetails>((await q.OrderBy(x => x.Name).ThenBy(x => x.Id).Skip((page - 1) * 25).Take(25).ToArrayAsync(ct)).Select(PartnerDto).ToArray(), await q.CountAsync(ct), page, 25);
    }, ct);
    public Task<PartnerDetails> GetPartner(Guid id, CancellationToken ct) => Scoped(Permissions.PartnersRead, async _ => PartnerDto(await Partner(id, ct)), ct);
    public Task<PartnerDetails> SavePartner(Guid? id, PartnerInput input, CancellationToken ct) => Scoped(id is null ? Permissions.PartnersCreate : Permissions.PartnersUpdate, async _ =>
    {
        var data = FleetValidation.Partner(input);
        var p = id is { } key ? await Partner(key, ct) : new Partner { TenantId = TenantId, Name = data.Name, CreatedBy = Actor };
        var before = id is null ? null : PartnerDto(p);
        if (id is not null)
        {
            FleetValidation.Revision(p.Version, data.Version);
            if (p.IsArchived) throw Error(409, "partner_archived", "Előbb állítsd vissza az archivált partnert.");
            await CheckPartnerReferences(p.Id, !data.IsLessor, !data.IsService, ct);
            p.Version++; p.UpdatedAt = DateTimeOffset.UtcNow; p.UpdatedBy = Actor;
        }
        else db.Partners.Add(p);
        p.Name = data.Name; p.IsLessor = data.IsLessor; p.IsService = data.IsService; p.CountryCode = data.Address.CountryCode;
        p.PostalCode = data.Address.PostalCode; p.City = data.Address.City; p.AddressLine1 = data.Address.AddressLine1; p.AddressLine2 = data.Address.AddressLine2;
        p.SearchText = $"{p.Name} {p.City}".Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        p.Email = data.Email; p.Phone = data.Phone; p.Website = data.Website; p.Notes = data.Notes; p.ContactsJson = JsonSerializer.Serialize(data.Contacts);
        var after = PartnerDto(p); Audit(id is null ? "partner.created" : "partner.updated", p.Id, before, after); await db.SaveChangesAsync(ct); return after;
    }, ct);
    private async Task CheckPartnerReferences(Guid id, bool lessor, bool service, CancellationToken ct)
    {
        if (lessor && await db.VehicleLeases.AnyAsync(x => x.PartnerId == id && x.Status == "Active", ct))
            throw Error(409, "partner_in_use", "A partnerhez aktív lízingszerződés tartozik. Előbb zárd le vagy helyezd át a szerződést.");
        if (service && await db.VehicleProfiles.AnyAsync(x => x.PreferredServicePartnerId == id, ct))
            throw Error(409, "partner_in_use", "A partner jármű alapértelmezett szervize. Előbb módosítsd a jármű szervizpartnerét.");
    }
    public Task<PartnerDetails> PartnerStatus(Guid id, ChangeArchiveStatus input, CancellationToken ct) => Scoped(Permissions.PartnersArchive, async _ =>
    {
        var p = await Partner(id, ct); FleetValidation.Revision(p.Version, input.Version); var reason = OrganizationValidation.Reason(input.Reason);
        if (input.IsArchived is null) throw FleetValidation.Invalid("Add meg az archivált állapotot.");
        if (p.IsArchived == input.IsArchived) return PartnerDto(p);
        if (input.IsArchived == true) await CheckPartnerReferences(id, true, true, ct);
        var before = PartnerDto(p); p.IsArchived = input.IsArchived.Value; p.StatusReason = reason; p.Version++; p.UpdatedAt = DateTimeOffset.UtcNow; p.UpdatedBy = Actor;
        var after = PartnerDto(p); Audit("partner.status_changed", id, before, after); await db.SaveChangesAsync(ct); return after;
    }, ct);
    // A vehicle operator without partners.read gets only the names needed for that permitted operation.
    public Task<PartnerOption[]> PartnerOptions(Guid id, string purpose, CancellationToken ct)
    {
        var permission = purpose switch { "leasing" => Permissions.LeasingManage, "service" => Permissions.ServicesManage, "preferred-service" => Permissions.VehiclesUpdate,
            _ => throw FleetValidation.Invalid("Ismeretlen partnerkiválasztási művelet.") };
        return Scoped(permission, async access =>
        {
            await Car(id, access, permission, ct);
            return await db.Partners.AsNoTracking().Where(x => !x.IsArchived && (purpose == "leasing" ? x.IsLessor : x.IsService))
                .OrderBy(x => x.Name).ThenBy(x => x.Id).Select(x => new PartnerOption(x.Id, x.Name)).ToArrayAsync(ct);
        }, ct);
    }
}
