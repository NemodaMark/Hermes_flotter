using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static PartnerInput PartnerData(string name = "Flotta partner", bool lessor = true, bool service = true) => new(name, lessor, service,
        new("HU", "1111", "Budapest", "Műhely utca 1.", null), "info@example.test", "+36 1 555 1111", "https://example.test", "Szerződéses partner",
        [new("Kiss Éva", "Kapcsolattartó", "eva@example.test", "+36 30 1111111")]);
    private static async Task<PartnerDetails> FleetPartner(Account owner, PartnerInput? data = null) => await ScopeOk<PartnerDetails>(await owner.Client.PostAsJsonAsync("/api/v1/partners", data ?? PartnerData()));
    private static async Task<VehicleRecord> FleetCar(Account owner, string registration = "FLEET-001", Guid? site = null, string ownership = "Leased")
    {
        var v = await ScopeCar(owner, registration, site);
        var record = (await owner.Client.GetFromJsonAsync<VehicleRecord>($"/api/v1/vehicles/{v.Id}/details"))!;
        return await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync($"/api/v1/vehicles/{v.Id}/details",
            new SaveVehicleRecord(v.Registration, v.Make, v.Model, "Active", v.Version, record.Data with { Ownership = ownership })));
    }
    private static LeaseInput LeaseData(Guid partner, string number = "LEASE-01") => new(partner, number, new(2026, 1, 1), new(2028, 12, 31),
        250000.50m, "HUF", "Monthly", 30000, 90000, "Active", "https://example.test/lease.pdf", "Lízingszerződés");
    private static ServiceInput ServiceData(Guid partner) => new(partner, new(2025, 6, 1), 10000, "Olaj- és szűrőcsere", "WORK-01", 45000.25m,
        "HUF", new(2026, 6, 1), 25000, "https://example.test/work.pdf", "Gyári alkatrészek");
    private static string CarUrl(VehicleRecord record) => $"/api/v1/vehicles/{record.Vehicle.Id}";

    [Fact]
    public async Task Vehicle_details_keep_the_internal_key_and_all_registration_history_with_atomic_validation()
    {
        using var owner = await Register(); using var foreign = await Register(); await Company(owner); await Company(foreign);
        var car = await FleetCar(owner); var url = CarUrl(car);
        var data = car.Data with { Vin = "wvwzzz1jzxw000001", FleetNumber = "van-01", Category = "Van", Year = 2021, FuelType = "Diesel", PowerKw = 110.5m,
            EngineCapacityCc = 1995, Transmission = "Manual", Seats = 3, GrossWeightKg = 3500, PayloadKg = 1200, CargoVolumeM3 = 12.5m,
            FirstRegistration = new(2021, 3, 1), FleetEntryDate = new(2025, 1, 1), InspectionDueDate = new(2027, 3, 1), NextServiceKm = 30000, Notes = "Teszt jármű" };
        var saved = await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord(" new-001 ", "Ford", "Transit", "Maintenance", car.Vehicle.Version, data)));
        Assert.Equal(car.Vehicle.Id, saved.Vehicle.Id); Assert.Equal("NEW-001", saved.Vehicle.Registration); Assert.Equal("Maintenance", saved.Vehicle.Status);
        Assert.Equal("WVWZZZ1JZXW000001", saved.Data.Vin); Assert.Equal("VAN-01", saved.Data.FleetNumber); Assert.Equal(data.PowerKw, saved.Data.PowerKw);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord("STALE", "Ford", "Transit", "Active", car.Vehicle.Version, data))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord("BAD", "Ford", "Transit", "Archived", saved.Vehicle.Version, data))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord("BAD", "Ford", "Transit", "Active", saved.Vehicle.Version, data with { Vin = "invalid" }))).StatusCode);
        var other = await FleetCar(owner, "FLEET-002");
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(CarUrl(other) + "/details", new SaveVehicleRecord("FLEET-002", "Ford", "Focus", "Active", other.Vehicle.Version, saved.Data))).StatusCode);
        Assert.Equal("NEW-001", (await owner.Client.GetFromJsonAsync<VehicleRecord>(url + "/details"))!.Vehicle.Registration);
        Assert.Equal(2, (await owner.Client.GetFromJsonAsync<PageResult<RegistrationEntry>>(url + "/registrations"))!.Total);
        var oldUpdate = await ScopeOk<VehicleSummary>(await owner.Client.PutAsJsonAsync(url, new UpdateVehicleRequest("NEW-002", "Ford", "Transit", saved.Vehicle.Version)));
        Assert.Equal(car.Vehicle.Id, oldUpdate.Id);
        Assert.Equal(3, (await owner.Client.GetFromJsonAsync<PageResult<RegistrationEntry>>(url + "/registrations"))!.Total);
        Assert.Contains("FLEET-001", (await owner.Client.GetFromJsonAsync<VehicleSummary[]>("/api/v1/vehicles"))!.Single(x => x.Id == car.Vehicle.Id).PreviousRegistrations);
        foreach (var suffix in new[] { "/details", "/registrations", "/odometer", "/audit-events", "/site-options" })
            Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(url + suffix)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord("FORGED", "Ford", "Focus", "Active", oldUpdate.Version, saved.Data))).StatusCode);
        var log = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(url + "/audit-events"))!;
        Assert.Contains(log.Items, x => x.Action == "vehicle.details_updated" && x.Details.Contains("NEW-001") && x.ActorSubject == owner.User.Id);
        var context = new TenantContext(); context.Set(car.Vehicle.SiteId ?? (await owner.Client.GetFromJsonAsync<TenantSummary[]>("/api/v1/tenants"))![0].Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await Assert.ThrowsAnyAsync<Exception>(() => TenantTransaction.RunAsync(db, context.TenantId!.Value, async () =>
            await db.VehicleRegistrations.Where(x => x.VehicleId == car.Vehicle.Id).ExecuteDeleteAsync(), default));
    }

    [Fact]
    public async Task Sold_ownership_sets_inactive_on_create_and_update()
    {
        using var owner = await Register(); using var foreign = await Register();
        await Company(owner); await Company(foreign);
        var car = await FleetCar(owner, ownership: "Owned");
        var url = CarUrl(car);
        var sale = new SaveVehicleRecord(car.Vehicle.Registration, car.Vehicle.Make, car.Vehicle.Model, "Active", car.Vehicle.Version,
            car.Data with { Ownership = "Sold" });

        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PutAsJsonAsync(url + "/details", sale)).StatusCode);
        var sold = await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync(url + "/details", sale));
        Assert.Equal("Sold", sold.Data.Ownership);
        Assert.Equal("Inactive", sold.Vehicle.Status);
        var attemptedReactivation = await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync(url + "/details",
            sale with { Status = "Maintenance", Version = sold.Vehicle.Version }));
        Assert.Equal("Inactive", attemptedReactivation.Vehicle.Status);
        Assert.Equal("Inactive", (await owner.Client.GetFromJsonAsync<VehicleRecord>(url + "/details"))!.Vehicle.Status);
        var log = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(url + "/audit-events"))!;
        Assert.Contains(log.Items, e => e.Action == "vehicle.details_updated" && e.Details.Contains("Sold") && e.Details.Contains("Inactive"));

        var historical = await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync("/api/v1/vehicles",
            new CreateVehicleRequest("SOLD-002", "Ford", "Focus", Data: new() { Ownership = "Sold" })));
        Assert.Equal("Inactive", historical.Status);
        Assert.Equal("Sold", (await owner.Client.GetFromJsonAsync<VehicleRecord>($"/api/v1/vehicles/{historical.Id}/details"))!.Data.Ownership);
    }

    [Fact]
    public async Task Partners_have_categories_multiple_contacts_archive_recovery_and_company_isolation()
    {
        using var owner = await Register(); using var foreign = await Register(); await Company(owner); await Company(foreign);
        var partner = await FleetPartner(owner); var url = $"/api/v1/partners/{partner.Id}";
        var saved = await ScopeOk<PartnerDetails>(await owner.Client.PutAsJsonAsync(url, partner.Data with { Name = "Új név", Contacts = [..partner.Data.Contacts, new("Nagy Béla", "Szervizvezető", null, "+36 30 2222222")] }));
        Assert.Equal(2, saved.Data.Contacts.Length); Assert.True(saved.Data.IsLessor); Assert.True(saved.Data.IsService);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url, partner.Data)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/partners", PartnerData() with { IsLessor = false, IsService = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/partners", PartnerData() with { Website = "javascript:alert(1)" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PutAsJsonAsync(url, saved.Data)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PatchAsJsonAsync(url + "/status", new ChangeArchiveStatus(true, "Tiltott", saved.Data.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(url + "/audit-events")).StatusCode);
        Assert.Empty((await foreign.Client.GetFromJsonAsync<PageResult<PartnerDetails>>("/api/v1/partners"))!.Items);
        Assert.Equal(1, (await owner.Client.GetFromJsonAsync<PageResult<PartnerDetails>>("/api/v1/partners?kind=service&search=Új"))!.Total);
        var archived = await ScopeOk<PartnerDetails>(await owner.Client.PatchAsJsonAsync(url + "/status", new ChangeArchiveStatus(true, "Szerződés megszűnt", saved.Data.Version)));
        Assert.Empty((await owner.Client.GetFromJsonAsync<PageResult<PartnerDetails>>("/api/v1/partners"))!.Items);
        Assert.True(Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<PartnerDetails>>("/api/v1/partners?includeArchived=true"))!.Items).IsArchived);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url, archived.Data)).StatusCode);
        await ScopeOk<PartnerDetails>(await owner.Client.PatchAsJsonAsync(url + "/status", new ChangeArchiveStatus(false, "Újra partner", archived.Data.Version)));
        Assert.Equal(4, (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(url + "/audit-events"))!.Total);
        owner.Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync("/api/v1/partners", PartnerData())).StatusCode);
    }

    [Fact]
    public async Task Lease_lifecycle_validates_ownership_periods_money_versions_and_partner_references()
    {
        using var owner = await Register(); using var foreign = await Register(); await Company(owner); await Company(foreign);
        var car = await FleetCar(owner, ownership: "Owned"); var partner = await FleetPartner(owner); var other = await FleetPartner(foreign); var url = CarUrl(car);
        var input = LeaseData(partner.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/leases", input)).StatusCode);
        car = await ScopeOk<VehicleRecord>(await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord(car.Vehicle.Registration, "Ford", "Focus", "Active", car.Vehicle.Version, car.Data with { Ownership = "Leased" })));
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.PostAsJsonAsync(url + "/leases", input with { PartnerId = other.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(url + "/leases", input with { PaymentAmount = -1 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(url + "/leases", input with { EndDate = new(2020, 1, 1) })).StatusCode);
        var lease = await ScopeOk<LeaseDetails>(await owner.Client.PostAsJsonAsync(url + "/leases", input));
        Assert.Equal(input.PaymentAmount, lease.Data.PaymentAmount); Assert.Equal(partner.Data.Name, lease.PartnerName);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/leases", input with { ContractNumber = "OVERLAP" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync($"/api/v1/partners/{partner.Id}", partner.Data with { IsLessor = false })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync($"/api/v1/partners/{partner.Id}/status", new ChangeArchiveStatus(true, "Bezárás", partner.Data.Version))).StatusCode);
        var now = (await owner.Client.GetFromJsonAsync<VehicleRecord>(url + "/details"))!;
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord(now.Vehicle.Registration, "Ford", "Focus", "Active", now.Vehicle.Version, now.Data with { Ownership = "Owned" }))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord(now.Vehicle.Registration, "Ford", "Focus", "Inactive", now.Vehicle.Version, now.Data with { Ownership = "Sold" }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(url + "/leases")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PutAsJsonAsync(url + $"/leases/{lease.Id}", lease.Data)).StatusCode);
        var closed = await ScopeOk<LeaseDetails>(await owner.Client.PutAsJsonAsync(url + $"/leases/{lease.Id}", lease.Data with { Status = "Closed" }));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + $"/leases/{lease.Id}", lease.Data)).StatusCode);
        await ScopeOk<PartnerDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/partners/{partner.Id}/status", new ChangeArchiveStatus(true, "Lezárt kapcsolat", partner.Data.Version)));
        var historical = await ScopeOk<LeaseDetails>(await owner.Client.PutAsJsonAsync(url + $"/leases/{lease.Id}", closed.Data with { Notes = "Történeti pontosítás" }));
        Assert.Equal(partner.Id, historical.Data.PartnerId); Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<LeaseDetails>>(url + "/leases"))!.Items);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/leases", input with { StartDate = new(2029, 1, 1), EndDate = new(2030, 1, 1) })).StatusCode);
        Assert.Contains((await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(url + "/audit-events"))!.Items, x => x.Action == "vehicle.lease_updated" && x.Details.Contains("Closed"));
    }

    [Fact]
    public async Task Service_history_does_not_rewrite_current_odometer_and_voiding_keeps_the_record_and_audit()
    {
        using var owner = await Register(); using var foreign = await Register(); await Company(owner); await Company(foreign);
        var car = await FleetCar(owner); var partner = await FleetPartner(owner); var other = await FleetPartner(foreign); var url = CarUrl(car);
        await ScopeOk<VehicleSummary>(await owner.Client.PostAsJsonAsync(url + "/odometer", new RecordOdometerRequest(50000, car.Vehicle.Version)));
        var input = ServiceData(partner.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.PostAsJsonAsync(url + "/services", input with { PartnerId = other.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(url + "/services", input with { PerformedOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync(url + "/services", input with { NextServiceKm = 9999 })).StatusCode);
        var service = await ScopeOk<ServiceDetails>(await owner.Client.PostAsJsonAsync(url + "/services", input));
        Assert.Equal(50000, (await owner.Client.GetFromJsonAsync<VehicleRecord>(url + "/details"))!.Vehicle.OdometerKm);
        Assert.Equal(1, (await owner.Client.GetFromJsonAsync<PageResult<OdometerEntry>>(url + "/odometer"))!.Total);
        var updated = await ScopeOk<ServiceDetails>(await owner.Client.PutAsJsonAsync(url + $"/services/{service.Id}", service.Data with { Cost = 47000.50m }));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + $"/services/{service.Id}", service.Data)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(url + "/services")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PostAsJsonAsync(url + "/services", input)).StatusCode);
        var voided = await ScopeOk<ServiceDetails>(await owner.Client.PostAsJsonAsync(url + $"/services/{service.Id}/void", new VersionReason(updated.Data.Version, "Téves munkalap")));
        Assert.True(voided.IsVoided); Assert.Equal("Téves munkalap", voided.VoidReason);
        Assert.Empty((await owner.Client.GetFromJsonAsync<PageResult<ServiceDetails>>(url + "/services"))!.Items);
        Assert.True(Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<ServiceDetails>>(url + "/services?includeVoided=true"))!.Items).IsVoided);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + $"/services/{service.Id}", voided.Data)).StatusCode);
        Assert.Contains((await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(url + "/audit-events"))!.Items, x => x.Action == "vehicle.service_voided" && x.Details.Contains("Téves munkalap"));
        var closedPartner = await ScopeOk<PartnerDetails>(await owner.Client.PatchAsJsonAsync($"/api/v1/partners/{partner.Id}/status", new ChangeArchiveStatus(true, "Már nem szervizel", partner.Data.Version)));
        Assert.True(closedPartner.IsArchived); Assert.Equal(partner.Data.Name, Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<ServiceDetails>>(url + "/services?includeVoided=true"))!.Items).PartnerName);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/services", input)).StatusCode);
    }

    [Fact]
    public async Task Archived_vehicles_keep_history_but_block_every_vehicle_write_until_authorized_restore()
    {
        using var owner = await Register(); await Company(owner); var car = await FleetCar(owner); var partner = await FleetPartner(owner); var url = CarUrl(car);
        var archived = await ScopeOk<VehicleRecord>(await owner.Client.PatchAsJsonAsync(url + "/status", new VehicleStateInput(true, "Eladott jármű", car.Vehicle.Version)));
        Assert.Equal("Archived", archived.Vehicle.Status); Assert.Equal(car.Vehicle.Id, archived.Vehicle.Id);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url, new UpdateVehicleRequest("BLOCKED", "Ford", "Focus", archived.Vehicle.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync(url + "/details", new SaveVehicleRecord("BLOCKED", "Ford", "Focus", "Active", archived.Vehicle.Version, archived.Data))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/odometer", new RecordOdometerRequest(1000, archived.Vehicle.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/leases", LeaseData(partner.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsJsonAsync(url + "/services", ServiceData(partner.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PutAsJsonAsync($"/api/v1/company/vehicles/{car.Vehicle.Id}/site", new AssignVehicleSite(null, archived.Vehicle.Version))).StatusCode);
        Assert.Single((await owner.Client.GetFromJsonAsync<PageResult<RegistrationEntry>>(url + "/registrations"))!.Items);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PatchAsJsonAsync(url + "/status", new { reason = "Hiányos", version = archived.Vehicle.Version })).StatusCode);
        var restored = await ScopeOk<VehicleRecord>(await owner.Client.PatchAsJsonAsync(url + "/status", new VehicleStateInput(false, "Újra használatban", archived.Vehicle.Version)));
        Assert.Equal("Inactive", restored.Vehicle.Status); Assert.Equal("Leased", restored.Data.Ownership);
    }
}
