using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;

namespace Hermes.Api;

public static class OrganizationEndpoints
{
    public static void MapOrganizationEndpoints(this WebApplication app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization();
        api.MapGet("/companies", async (HttpContext http, OrganizationManagement organizations, CancellationToken ct,
            int page = 1, string? search = null, string status = "Active")
            => Results.Ok(await organizations.List(http.User.FindFirst("sub")!.Value, page, search, status, ct)));
        // Only these management routes can address inactive companies. Each action still checks its own company permission.
        var company = api.MapGroup("/company").WithMetadata(new TenantRequired(AllowInactive: true));
        company.MapGet("/", async (OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.Get(ct))).RequireAuthorization(Permissions.CompaniesRead);
        company.MapGet("/state", async (OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.State(ct))).RequireAuthorization(Permissions.CompaniesStatus);
        company.MapPut("/", async (CompanyInput input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.Update(input, ct))).RequireAuthorization(Permissions.CompaniesUpdate);
        company.MapPatch("/status", async (ChangeCompanyStatus input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.Status(input, ct))).RequireAuthorization(Permissions.CompaniesStatus);
        company.MapGet("/contacts", async (OrganizationManagement service, CancellationToken ct, bool includeArchived = false) => Results.Ok(await service.Contacts(includeArchived, ct))).RequireAuthorization(Permissions.CompaniesRead);
        company.MapPost("/contacts", async (ContactInput input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.SaveContact(null, input, ct))).RequireAuthorization(Permissions.CompaniesUpdate);
        company.MapPut("/contacts/{id:guid}", async (Guid id, ContactInput input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.SaveContact(id, input, ct))).RequireAuthorization(Permissions.CompaniesUpdate);
        company.MapPatch("/contacts/{id:guid}/status", async (Guid id, ChangeArchiveStatus input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.ContactStatus(id, input, ct))).RequireAuthorization(Permissions.CompaniesUpdate);
        company.MapGet("/sites", async (OrganizationManagement service, CancellationToken ct, bool includeArchived = false) => Results.Ok(await service.Sites(includeArchived, ct))).RequireAuthorization(Permissions.SitesRead);
        company.MapPost("/sites", async (SiteInput input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.SaveSite(null, input, ct))).RequireAuthorization(Permissions.SitesCreate);
        company.MapPut("/sites/{id:guid}", async (Guid id, SiteInput input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.SaveSite(id, input, ct))).RequireAuthorization(Permissions.SitesUpdate);
        company.MapPatch("/sites/{id:guid}/status", async (Guid id, ChangeArchiveStatus input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.SiteStatus(id, input, ct))).RequireAuthorization(Permissions.SitesArchive);
        company.MapGet("/vehicles", async (OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.Vehicles(ct))).RequireAuthorization(Permissions.SitesRead, Permissions.VehiclesRead);
        company.MapPut("/vehicles/{id:guid}/site", async (Guid id, AssignVehicleSite input, OrganizationManagement service, CancellationToken ct) => Results.Ok(await service.Assign(id, input, ct))).RequireAuthorization(Permissions.SitesAssignVehicles, Permissions.VehiclesRead);
        company.MapGet("/audit-events", async (OrganizationManagement service, CancellationToken ct, int page = 1) => Results.Ok(await service.History(page, ct))).RequireAuthorization(Permissions.AuditRead);
    }
}
