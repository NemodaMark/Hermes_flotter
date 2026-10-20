using System.Globalization;
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
    private static string VehicleDocs(VehicleRecord car) => CarUrl(car) + "/documents";
    private static async Task<HttpResponseMessage> SendVehicleDocument(Account actor, VehicleRecord car, long version, string? category = "Registration", byte[]? bytes = null)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(bytes ?? DocumentPdf), "file", "okmány.pdf");
        form.Add(new StringContent(version.ToString(CultureInfo.InvariantCulture)), "version");
        if (category is not null) form.Add(new StringContent(category), "category");
        return await actor.Client.PostAsync(VehicleDocs(car), form);
    }

    [Theory]
    [InlineData(VehicleDocumentCategories.Registration)]
    [InlineData(VehicleDocumentCategories.Insurance)]
    [InlineData(VehicleDocumentCategories.Inspection)]
    public async Task Vehicle_documents_round_trip_all_categories_with_versions_withdrawal_audit_and_company_isolation(string category)
    {
        using var owner = await Register(); using var foreign = await Register(); var company = await Company(owner); await Company(foreign);
        var car = await FleetCar(owner); var other = await FleetCar(owner, "OTHER-DOC");
        var file = await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, car, car.Vehicle.Version, category));
        Assert.Equal(category, file.Document.Category); Assert.Equal(car.Vehicle.Version + 1, file.VehicleVersion); Assert.Equal(file.VehicleVersion, file.ParentVersion);
        var path = VehicleDocs(car) + $"/{file.Document.Id}/content";
        var download = await owner.Client.GetAsync(path); Assert.Equal(DocumentPdf, await download.Content.ReadAsByteArrayAsync());
        Assert.Equal("application/pdf", download.Content.Headers.ContentType!.MediaType); Assert.Contains("no-store", download.Headers.CacheControl!.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(VehicleDocs(other) + $"/{file.Document.Id}/content")).StatusCode);
        using var anonymous = await fixture.ClientAsync(null, company.Id);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        var listing = (await owner.Client.GetFromJsonAsync<DocumentCollection>(VehicleDocs(car)))!;
        Assert.Equal(category, Assert.Single(listing.Items).Category); Assert.Equal(file.ParentVersion, listing.ParentVersion);
        Assert.Equal(HttpStatusCode.Conflict, (await SendVehicleDocument(owner, car, car.Vehicle.Version, category)).StatusCode);
        var statusPath = VehicleDocs(car) + $"/{file.Document.Id}/status";
        var withdrawn = await ScopeOk<DocumentChange>(await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(true, "Téves okmány", 1, file.ParentVersion)));
        Assert.Equal(category, withdrawn.Document.Category); Assert.True(withdrawn.Document.IsWithdrawn); Assert.Equal(file.ParentVersion + 1, withdrawn.VehicleVersion);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "Tiltott", 2, withdrawn.ParentVersion))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "", 2, withdrawn.ParentVersion))).StatusCode);
        var restored = await ScopeOk<DocumentChange>(await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "Ellenőrzött okmány", 2, withdrawn.ParentVersion)));
        Assert.False(restored.Document.IsWithdrawn); Assert.Equal(DocumentPdf, await (await owner.Client.GetAsync(path)).Content.ReadAsByteArrayAsync());
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(CarUrl(car) + "/audit-events"))!;
        Assert.Single(audit.Items, x => x.Action == "vehicle.document_uploaded" && x.Details.Contains(category));
        Assert.Equal(2, audit.Items.Count(x => x.Action == "vehicle.document_status_changed"));
        Assert.DoesNotContain(audit.Items, x => x.Details.Contains(Convert.ToBase64String(DocumentPdf)));
        var context = new TenantContext(); context.Set(company.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        Assert.Equal(3, await db.SystemAuditEvents.CountAsync(x => x.TenantId == company.Id && (x.Action == "vehicle.document_uploaded" || x.Action == "vehicle.document_status_changed")));
    }

    [Fact]
    public async Task Vehicle_document_permissions_follow_their_own_source_sites_and_do_not_grant_lease_or_service_access()
    {
        using var owner = await Register(); using var member = await Register(); var company = await Company(owner);
        var a = await ScopeSite(owner, "DOC-A"); var b = await ScopeSite(owner, "DOC-B");
        var carA = await FleetCar(owner, "V-DOC-A", a.Id); var carB = await FleetCar(owner, "V-DOC-B", b.Id); var none = await FleetCar(owner, "V-DOC-N");
        var fileA = await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, carA, carA.Vehicle.Version));
        var fileB = await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, carB, carB.Vehicle.Version));
        var readA = await ScopedGroup(owner, "Okmányolvasó A", company.Id, [a.Id], Permissions.DocumentsRead);
        var writeB = await ScopedGroup(owner, "Okmánykezelő B", company.Id, [b.Id], Permissions.DocumentsManage);
        await CompanyAssign(owner, member.User.Id, readA.Id, writeB.Id); Select(member, company.Id);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(VehicleDocs(carA))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(VehicleDocs(carA) + $"/{fileA.Document.Id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(VehicleDocs(carB))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(VehicleDocs(carB) + $"/{fileB.Document.Id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendVehicleDocument(member, carA, fileA.ParentVersion)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SendVehicleDocument(member, carB, fileB.ParentVersion, "Insurance")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendVehicleDocument(member, none, none.Vehicle.Version)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(VehicleDocs(none))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PatchAsJsonAsync(VehicleDocs(carA) + $"/{fileA.Document.Id}/status", new DocumentStatusInput(true, "Tiltott", 1, fileA.ParentVersion))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(CarUrl(carA) + "/leases")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(CarUrl(carA) + "/services")).StatusCode);
        using var vehicleOnly = await Register(); await Join(owner, vehicleOnly, company.Id, Permissions.VehiclesRead, Permissions.VehiclesUpdate, Permissions.LeasingManage, Permissions.ServicesManage);
        Assert.Equal(HttpStatusCode.Forbidden, (await vehicleOnly.Client.GetAsync(VehicleDocs(carA))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendVehicleDocument(vehicleOnly, carA, fileA.ParentVersion)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await vehicleOnly.Client.GetAsync(VehicleDocs(carA) + $"/{fileA.Document.Id}/content")).StatusCode);
    }

    [Fact]
    public async Task Vehicle_document_categories_and_upload_protection_reject_invalid_requests_without_mutating_the_vehicle()
    {
        using var owner = await Register(); await Company(owner); var car = await FleetCar(owner);
        foreach (var category in new string?[] { null, "", "Unknown", "registration" })
            Assert.Equal(HttpStatusCode.BadRequest, (await SendVehicleDocument(owner, car, car.Vehicle.Version, category)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendVehicleDocument(owner, car, car.Vehicle.Version, bytes: [1, 2, 3])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendVehicleDocument(owner, car, 0)).StatusCode);
        owner.Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await SendVehicleDocument(owner, car, car.Vehicle.Version)).StatusCode);
        await FleetFixture.RefreshCsrfAsync(owner.Client);
        var files = (await owner.Client.GetFromJsonAsync<DocumentCollection>(VehicleDocs(car)))!;
        Assert.Empty(files.Items); Assert.Equal(car.Vehicle.Version, files.ParentVersion);
    }

    [Fact]
    public async Task Vehicle_document_history_is_readable_after_archive_and_cannot_be_accessed_through_contract_routes()
    {
        using var owner = await Register(); await Company(owner); var item = await DocumentSetup(owner, true);
        var direct = await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, item.Car, item.Car.Vehicle.Version));
        var lease = await ScopeOk<DocumentChange>(await SendDocument(owner, item, 1));
        Assert.Single((await owner.Client.GetFromJsonAsync<DocumentCollection>(VehicleDocs(item.Car)))!.Items);
        Assert.Single((await owner.Client.GetFromJsonAsync<DocumentCollection>(item.Url))!.Items);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(item.Url + $"/{direct.Document.Id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(VehicleDocs(item.Car) + $"/{lease.Document.Id}/content")).StatusCode);
        await ScopeOk<VehicleRecord>(await owner.Client.PatchAsJsonAsync(CarUrl(item.Car) + "/status", new VehicleStateInput(true, "Archiválás", lease.VehicleVersion)));
        Assert.Equal(HttpStatusCode.Conflict, (await SendVehicleDocument(owner, item.Car, lease.VehicleVersion + 1)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync(VehicleDocs(item.Car) + $"/{direct.Document.Id}/status", new DocumentStatusInput(true, "Visszavonás", 1, lease.VehicleVersion + 1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync(VehicleDocs(item.Car) + $"/{direct.Document.Id}/content")).StatusCode);
    }

    [Fact]
    public async Task Vehicle_document_access_is_rechecked_after_receiving_the_file_and_a_new_vehicle_version_conflicts()
    {
        using var owner = await Register(); using var member = await Register(); var company = await Company(owner);
        var a = await ScopeSite(owner, "VUP-A"); var b = await ScopeSite(owner, "VUP-B"); var car = await FleetCar(owner, site: a.Id);
        var group = await ScopedGroup(owner, "Okmánykezelő", company.Id, [a.Id], Permissions.DocumentsManage);
        await CompanyAssign(owner, member.User.Id, group.Id);
        var context = new TenantContext(); context.Set(company.Id, member.User.Id, [Permissions.DocumentsManage]);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        var manager = new FleetManagement(db, context);
        var error = await Assert.ThrowsAsync<ManagementException>(() => manager.UploadDocument(car.Vehicle.Id, car.Vehicle.Id, false, async () =>
        {
            await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}", new UpdateGroupRequest(group.Name, group.Permissions, [company.Id], group.Version, SiteScopes: [new(company.Id, false, [b.Id])])));
            return new DocumentUpload("okmany.pdf", DocumentPdf, car.Vehicle.Version, "Insurance");
        }, default, vehicle: true));
        Assert.Equal(404, error.StatusCode);
        Assert.Empty((await owner.Client.GetFromJsonAsync<DocumentCollection>(VehicleDocs(car)))!.Items);
        var ownerContext = new TenantContext(); ownerContext.Set(company.Id, owner.User.Id, Permissions.All);
        await using var ownerDb = FleetFixture.CreateContext(fixture.ApplicationConnection, ownerContext);
        var conflict = await Assert.ThrowsAsync<ManagementException>(() => new FleetManagement(ownerDb, ownerContext).UploadDocument(car.Vehicle.Id, car.Vehicle.Id, false, async () =>
        {
            await TenantTransaction.RunAsync(db, company.Id, async () => await db.Vehicles.Where(x => x.Id == car.Vehicle.Id).ExecuteUpdateAsync(x => x.SetProperty(v => v.Version, v => v.Version + 1)), default);
            return new DocumentUpload("okmany.pdf", DocumentPdf, car.Vehicle.Version, "Inspection");
        }, default, vehicle: true));
        Assert.Equal(409, conflict.StatusCode); Assert.Empty((await owner.Client.GetFromJsonAsync<DocumentCollection>(VehicleDocs(car)))!.Items);
    }

    [Fact]
    public async Task Vehicle_document_quota_is_shared_by_all_categories_and_restore_respects_it()
    {
        using var owner = await Register(); await Company(owner); var car = await FleetCar(owner); DocumentChange first = null!;
        var categories = new[] { "Registration", "Insurance", "Inspection" };
        for (var i = 0; i < DocumentLimits.ActiveFiles; i++)
        {
            var result = await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, car, car.Vehicle.Version + i, categories[i % 3]));
            if (i == 0) first = result;
        }
        var version = car.Vehicle.Version + DocumentLimits.ActiveFiles;
        Assert.Equal(HttpStatusCode.Conflict, (await SendVehicleDocument(owner, car, version)).StatusCode);
        var path = VehicleDocs(car) + $"/{first.Document.Id}/status";
        await ScopeOk<DocumentChange>(await owner.Client.PatchAsJsonAsync(path, new DocumentStatusInput(true, "Csere", 1, version)));
        await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, car, version + 1, "Insurance"));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync(path, new DocumentStatusInput(false, "Vissza", 2, version + 2))).StatusCode);
        var listing = (await owner.Client.GetFromJsonAsync<DocumentCollection>(VehicleDocs(car)))!;
        Assert.Equal(21, listing.Items.Length); Assert.Equal(20, listing.Items.Count(x => !x.IsWithdrawn));
    }

    [Fact]
    public async Task Vehicle_document_database_constraints_prevent_cross_company_links_multiple_parents_and_category_changes()
    {
        using var owner = await Register(); using var foreign = await Register(); var company = await Company(owner); await Company(foreign);
        var item = await DocumentSetup(owner, true); var other = await FleetCar(foreign);
        var document = await ScopeOk<DocumentChange>(await SendVehicleDocument(owner, item.Car, item.Car.Vehicle.Version));
        var context = new TenantContext(); context.Set(company.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await Assert.ThrowsAnyAsync<Exception>(() => TenantTransaction.RunAsync(db, company.Id, async () => await db.VehicleDocuments.Where(x => x.Id == document.Document.Id).ExecuteUpdateAsync(x => x.SetProperty(d => d.Category, "Insurance")), default));
        await Assert.ThrowsAnyAsync<Exception>(() => TenantTransaction.RunAsync(db, company.Id, async () => await db.VehicleDocuments.Where(x => x.Id == document.Document.Id).ExecuteUpdateAsync(x => x.SetProperty(d => d.VehicleId, other.Vehicle.Id)), default));
        foreach (var invalid in new[] {
            new VehicleDocument { TenantId = company.Id, VehicleId = other.Vehicle.Id, Category = "Insurance", FileName = "cross.pdf", ContentType = "application/pdf", ByteLength = 1, Sha256 = "x", UploadedBy = owner.User.Id },
            new VehicleDocument { TenantId = company.Id, VehicleId = item.Car.Vehicle.Id, LeaseId = item.Parent, Category = "Inspection", FileName = "parents.pdf", ContentType = "application/pdf", ByteLength = 1, Sha256 = "x", UploadedBy = owner.User.Id },
            new VehicleDocument { TenantId = company.Id, VehicleId = item.Car.Vehicle.Id, FileName = "missing-type.pdf", ContentType = "application/pdf", ByteLength = 1, Sha256 = "x", UploadedBy = owner.User.Id } })
        {
            await Assert.ThrowsAnyAsync<DbUpdateException>(() => TenantTransaction.RunAsync(db, company.Id, async () => { db.VehicleDocuments.Add(invalid); return await db.SaveChangesAsync(); }, default));
            db.ChangeTracker.Clear();
        }
    }
}
