using System.Net;
using System.Net.Http.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    [Theory]
    [InlineData(Permissions.VehiclesArchive)]
    [InlineData(Permissions.LeasingRead)]
    [InlineData(Permissions.LeasingManage)]
    [InlineData(Permissions.ServicesRead)]
    [InlineData(Permissions.ServicesManage)]
    public async Task Each_new_vehicle_operation_enforces_its_own_group_site_scope_and_company_boundary(string permission)
    {
        using var owner = await Register(); using var member = await Register(); using var foreign = await Register();
        var company = await Company(owner); await Company(foreign);
        var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var carA = await FleetCar(owner, "ACCESS-A", a.Id); var carB = await FleetCar(owner, "ACCESS-B", b.Id); var noSite = await FleetCar(owner, "NO-SITE");
        var foreignCar = await FleetCar(foreign, "FOREIGN"); var partner = await FleetPartner(owner);
        var group = await ScopedGroup(owner, "Egyetlen művelet", company.Id, [a.Id], permission);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        async Task<HttpResponseMessage> Operate(VehicleRecord car) => permission switch
        {
            Permissions.VehiclesArchive => await member.Client.PatchAsJsonAsync(CarUrl(car) + "/status", new VehicleStateInput(true, "Archiválás", car.Vehicle.Version)),
            Permissions.LeasingRead => await member.Client.GetAsync(CarUrl(car) + "/leases"),
            Permissions.LeasingManage => await member.Client.PostAsJsonAsync(CarUrl(car) + "/leases", LeaseData(partner.Id)),
            Permissions.ServicesRead => await member.Client.GetAsync(CarUrl(car) + "/services"),
            _ => await member.Client.PostAsJsonAsync(CarUrl(car) + "/services", ServiceData(partner.Id))
        };
        Assert.Equal(HttpStatusCode.OK, (await Operate(carA)).StatusCode);
        foreach (var car in new[] { carB, noSite, foreignCar }) Assert.Equal(HttpStatusCode.NotFound, (await Operate(car)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/partners")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(CarUrl(carA) + "/details")).StatusCode);
        if (permission is Permissions.LeasingManage or Permissions.ServicesManage)
        {
            var purpose = permission == Permissions.LeasingManage ? "leasing" : "service";
            var options = await member.Client.GetAsync(CarUrl(carA) + $"/partner-options?purpose={purpose}");
            Assert.Equal(HttpStatusCode.OK, options.StatusCode); var json = await options.Content.ReadAsStringAsync();
            Assert.Contains(partner.Data.Name, json); Assert.DoesNotContain(partner.Data.Email!, json); Assert.DoesNotContain("contacts", json);
            Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(CarUrl(carB) + $"/partner-options?purpose={purpose}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(CarUrl(carA) + (purpose == "leasing" ? "/leases" : "/services"))).StatusCode);
        }
        Select(member, (await foreign.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))![0].Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await Operate(foreignCar)).StatusCode);
    }

    [Theory]
    [InlineData(Permissions.PartnersRead)]
    [InlineData(Permissions.PartnersCreate)]
    [InlineData(Permissions.PartnersUpdate)]
    [InlineData(Permissions.PartnersArchive)]
    public async Task Each_partner_operation_is_separately_grantable_through_a_group_and_stays_in_its_company(string permission)
    {
        using var owner = await Register(); using var member = await Register(); using var foreign = await Register();
        var company = await Company(owner); var otherCompany = await Company(foreign);
        var partner = await FleetPartner(owner); var other = await FleetPartner(foreign);
        var group = await ScopedGroup(owner, "Partner művelet", [new(company.Id, true, [])], permission);
        await CompanyAssign(owner, member.User.Id, group.Id); Select(member, company.Id);
        async Task<HttpResponseMessage> Operate(Guid id) => permission switch
        {
            Permissions.PartnersRead => await member.Client.GetAsync($"/api/v1/partners/{id}"),
            Permissions.PartnersCreate => await member.Client.PostAsJsonAsync("/api/v1/partners", PartnerData("Új partner")),
            Permissions.PartnersUpdate => await member.Client.PutAsJsonAsync($"/api/v1/partners/{id}", partner.Data with { Name = "Módosított" }),
            _ => await member.Client.PatchAsJsonAsync($"/api/v1/partners/{id}/status", new ChangeArchiveStatus(true, "Lezárás", partner.Data.Version))
        };
        Assert.Equal(HttpStatusCode.OK, (await Operate(partner.Id)).StatusCode);
        if (permission != Permissions.PartnersCreate) Assert.Equal(HttpStatusCode.NotFound, (await Operate(other.Id)).StatusCode);
        if (permission != Permissions.PartnersRead) Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/partners")).StatusCode);
        if (permission != Permissions.PartnersCreate) Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PostAsJsonAsync("/api/v1/partners", PartnerData())).StatusCode);
        if (permission != Permissions.PartnersUpdate) Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/v1/partners/{partner.Id}", partner.Data)).StatusCode);
        if (permission != Permissions.PartnersArchive) Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PatchAsJsonAsync($"/api/v1/partners/{partner.Id}/status", new ChangeArchiveStatus(true, "Tiltott", 1))).StatusCode);
        Select(member, otherCompany.Id); Assert.Equal(HttpStatusCode.Forbidden, (await Operate(other.Id)).StatusCode);
    }

    [Fact]
    public async Task Lease_service_and_audit_scopes_do_not_cross_multiply_between_source_groups()
    {
        using var owner = await Register(); using var member = await Register(); var company = await Company(owner);
        var a = await ScopeSite(owner, "A"); var b = await ScopeSite(owner, "B");
        var carA = await FleetCar(owner, "MATRIX-A", a.Id); var carB = await FleetCar(owner, "MATRIX-B", b.Id); var partner = await FleetPartner(owner);
        var leaseA = await ScopeOk<LeaseDetails>(await owner.Client.PostAsJsonAsync(CarUrl(carA) + "/leases", LeaseData(partner.Id, "A")));
        var leaseB = await ScopeOk<LeaseDetails>(await owner.Client.PostAsJsonAsync(CarUrl(carB) + "/leases", LeaseData(partner.Id, "B")));
        var groupA = await ScopedGroup(owner, "A pénzügy", company.Id, [a.Id], Permissions.VehiclesRead, Permissions.LeasingRead, Permissions.LeasingManage, Permissions.AuditRead);
        var groupB = await ScopedGroup(owner, "B szerviz", company.Id, [b.Id], Permissions.VehiclesRead, Permissions.ServicesRead, Permissions.ServicesManage);
        await CompanyAssign(owner, member.User.Id, groupA.Id, groupB.Id); Select(member, company.Id);
        Assert.Equal(2, (await member.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!.Length);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(CarUrl(carA) + "/leases")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(CarUrl(carB) + "/leases")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PutAsJsonAsync(CarUrl(carB) + $"/leases/{leaseB.Id}", leaseB.Data with { Status = "Closed" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PutAsJsonAsync(CarUrl(carA) + $"/leases/{leaseA.Id}", leaseA.Data with { Status = "Closed" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PostAsJsonAsync(CarUrl(carA) + "/services", ServiceData(partner.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.PostAsJsonAsync(CarUrl(carB) + "/services", ServiceData(partner.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(CarUrl(carB) + "/audit-events")).StatusCode);
        var audit = (await member.Client.GetFromJsonAsync<PageResult<AuditSummary>>("/api/v1/audit-events"))!;
        Assert.Contains(audit.Items, x => x.Action == "vehicle.lease_created" && x.Details.Contains(carA.Vehicle.Id.ToString()));
        Assert.DoesNotContain(audit.Items, x => x.Details.Contains(carB.Vehicle.Id.ToString()));
        await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{groupA.Id}",
            new UpdateGroupRequest(groupA.Name, groupA.Permissions, [company.Id], groupA.Version, SiteScopes: [new(company.Id, false, [b.Id])])));
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(CarUrl(carA) + "/leases")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(CarUrl(carB) + "/leases")).StatusCode);
        var manager = (await owner.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))!.Single();
        Assert.Contains(Permissions.PartnersArchive, manager.Permissions); Assert.Contains(Permissions.LeasingManage, manager.Permissions);
    }

    [Fact]
    public async Task New_fleet_tables_have_force_rls_and_composite_relationships_reject_foreign_partners()
    {
        using var owner = await Register(); using var foreign = await Register(); var company = await Company(owner); await Company(foreign);
        var car = await FleetCar(owner); var p = await FleetPartner(owner); var other = await FleetPartner(foreign);
        await ScopeOk<LeaseDetails>(await owner.Client.PostAsJsonAsync(CarUrl(car) + "/leases", LeaseData(p.Id)));
        await ScopeOk<ServiceDetails>(await owner.Client.PostAsJsonAsync(CarUrl(car) + "/services", ServiceData(p.Id)));
        await using (var unscoped = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
        {
            Assert.Empty(await unscoped.Partners.IgnoreQueryFilters().ToArrayAsync()); Assert.Empty(await unscoped.VehicleProfiles.IgnoreQueryFilters().ToArrayAsync());
            Assert.Empty(await unscoped.VehicleLeases.IgnoreQueryFilters().ToArrayAsync()); Assert.Empty(await unscoped.VehicleServices.IgnoreQueryFilters().ToArrayAsync());
            Assert.Empty(await unscoped.VehicleRegistrations.IgnoreQueryFilters().ToArrayAsync());
        }
        var context = new TenantContext(); context.Set(company.Id, owner.User.Id, Permissions.All);
        await using var scoped = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => TenantTransaction.RunAsync(scoped, company.Id, async () =>
        {
            scoped.VehicleLeases.Add(new() { TenantId = company.Id, VehicleId = car.Vehicle.Id, PartnerId = other.Id, ContractNumber = "FORGED", CreatedBy = owner.User.Id });
            return await scoped.SaveChangesAsync();
        }, default));
        scoped.ChangeTracker.Clear();
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => TenantTransaction.RunAsync(scoped, company.Id, async () =>
        {
            scoped.VehicleServices.Add(new() { TenantId = company.Id, VehicleId = car.Vehicle.Id, PartnerId = other.Id, Description = "FORGED", CreatedBy = owner.User.Id });
            return await scoped.SaveChangesAsync();
        }, default));
        scoped.ChangeTracker.Clear();
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => TenantTransaction.RunAsync(scoped, company.Id, async () =>
        {
            var profile = await scoped.VehicleProfiles.SingleAsync(x => x.VehicleId == car.Vehicle.Id); profile.PreferredServicePartnerId = other.Id;
            return await scoped.SaveChangesAsync();
        }, default));
    }
}
