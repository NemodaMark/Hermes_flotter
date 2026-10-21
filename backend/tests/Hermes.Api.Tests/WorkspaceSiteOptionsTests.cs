using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    [Fact]
    public async Task Workspace_site_options_include_empty_authorized_sites_without_exposing_other_scopes_or_companies()
    {
        using var owner = await Register(); using var member = await Register(); using var foreign = await Register();
        var company = await Company(owner);
        var visibleEmpty = await ScopeSite(owner, "EMPTY"); var hidden = await ScopeSite(owner, "HIDDEN");
        var otherCompany = await Company(foreign); await ScopeSite(foreign, "FOREIGN");
        var reader = await ScopedGroup(owner, "Olvasó", company.Id, [visibleEmpty.Id], Permissions.VehiclesRead);
        var editorElsewhere = await ScopedGroup(owner, "Másik telephely szerkesztője", company.Id, [hidden.Id], Permissions.VehiclesUpdate);
        await CompanyAssign(owner, member.User.Id, reader.Id, editorElsewhere.Id); Select(member, company.Id);
        var sites = await member.Client.GetFromJsonAsync<VehicleSiteOption[]>("/api/v1/vehicles/site-options");
        Assert.Equal(visibleEmpty.Id, Assert.Single(sites!).Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/company/sites")).StatusCode);
        Assert.Equal(2, (await owner.Client.GetFromJsonAsync<VehicleSiteOption[]>("/api/v1/vehicles/site-options"))!.Length);
        Select(member, otherCompany.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles/site-options")).StatusCode);
        await CompanyAssign(owner, member.User.Id, editorElsewhere.Id); Select(member, company.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/vehicles/site-options")).StatusCode);
    }
}
