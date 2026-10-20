using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Hermes.Application;
using Hermes.Domain;
using Hermes.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Hermes.Api.Tests;

public sealed partial class PermissionManagementTests
{
    private static readonly byte[] DocumentPdf = Encoding.ASCII.GetBytes("%PDF-1.7\nDocument test\n%%EOF");
    private sealed record DocumentCase(VehicleRecord Car, Guid Parent, long Version, bool Lease)
    {
        public string Url => $"{CarUrl(Car)}/{(Lease ? "leases" : "services")}/{Parent}/documents";
    }
    private static async Task<DocumentCase> DocumentSetup(Account owner, bool lease, string plate = "DOC-001", Guid? site = null)
    {
        var car = await FleetCar(owner, plate, site); var partner = await FleetPartner(owner);
        var id = lease ? (await ScopeOk<LeaseDetails>(await owner.Client.PostAsJsonAsync(CarUrl(car) + "/leases", LeaseData(partner.Id)))).Id
            : (await ScopeOk<ServiceDetails>(await owner.Client.PostAsJsonAsync(CarUrl(car) + "/services", ServiceData(partner.Id)))).Id;
        return new((await owner.Client.GetFromJsonAsync<VehicleRecord>(CarUrl(car) + "/details"))!, id, 1, lease);
    }
    private static async Task<HttpResponseMessage> SendDocument(Account actor, DocumentCase item, long version, byte[]? bytes = null, string name = "szerződés.pdf")
    {
        using var form = new MultipartFormDataContent();
        var content = new ByteArrayContent(bytes ?? DocumentPdf); content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(content, "file", name); form.Add(new StringContent(version.ToString(CultureInfo.InvariantCulture)), "version");
        return await actor.Client.PostAsync(item.Url, form);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Documents_round_trip_the_exact_file_with_scoped_downloads_versions_reversible_withdrawal_and_audit(bool lease)
    {
        using var owner = await Register(); using var foreign = await Register(); var company = await Company(owner); await Company(foreign);
        var item = await DocumentSetup(owner, lease); var other = await DocumentSetup(owner, lease, "DOC-002");
        var uploaded = await ScopeOk<DocumentChange>(await SendDocument(owner, item, 1, name: "C:\\fakepath\\lízing szerződés.pdf"));
        Assert.Equal("lízing szerződés.pdf", uploaded.Document.FileName); Assert.Equal("application/pdf", uploaded.Document.ContentType);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(DocumentPdf)), uploaded.Document.Sha256); Assert.Equal(DocumentPdf.Length, uploaded.Document.ByteLength);
        Assert.Equal(owner.User.Id, uploaded.Document.UploadedBy); Assert.Equal(2, uploaded.ParentVersion); Assert.Equal(item.Car.Vehicle.Version + 1, uploaded.VehicleVersion);
        var listResponse = await owner.Client.GetAsync(item.Url); var listing = (await listResponse.Content.ReadFromJsonAsync<DocumentCollection>())!;
        Assert.Single(listing.Items); Assert.Equal(2, listing.ParentVersion); Assert.DoesNotContain(Convert.ToBase64String(DocumentPdf), await listResponse.Content.ReadAsStringAsync());
        var path = item.Url + $"/{uploaded.Document.Id}/content"; var download = await owner.Client.GetAsync(path);
        Assert.Equal(DocumentPdf, await download.Content.ReadAsByteArrayAsync()); Assert.Equal("application/pdf", download.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition!.DispositionType); Assert.Contains("no-store", download.Headers.CacheControl!.ToString());
        Assert.Equal("nosniff", Assert.Single(download.Headers.GetValues("X-Content-Type-Options")));
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(other.Url + $"/{uploaded.Document.Id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync($"{CarUrl(other.Car)}/{(lease ? "leases" : "services")}/{item.Parent}/documents/{uploaded.Document.Id}/content")).StatusCode);
        using var anonymous = await fixture.ClientAsync(null, company.Id);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SendDocument(owner, item, 1)).StatusCode);
        var statusPath = item.Url + $"/{uploaded.Document.Id}/status";
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(true, "Tiltott", 1, 2))).StatusCode);
        var withdrawn = await ScopeOk<DocumentChange>(await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(true, "Téves melléklet", 1, 2)));
        Assert.True(withdrawn.Document.IsWithdrawn); Assert.Equal(3, withdrawn.ParentVersion); Assert.Equal(2, withdrawn.Document.Version);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.Client.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "Elavult", 1, 2))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "", 2, 3))).StatusCode);
        var restored = await ScopeOk<DocumentChange>(await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "Ellenőrizve, megfelelő", 2, 3)));
        Assert.False(restored.Document.IsWithdrawn); Assert.Equal(4, restored.ParentVersion); Assert.Equal(DocumentPdf, await (await owner.Client.GetAsync(path)).Content.ReadAsByteArrayAsync());
        var audit = (await owner.Client.GetFromJsonAsync<PageResult<AuditSummary>>(CarUrl(item.Car) + "/audit-events"))!;
        Assert.Equal(3, audit.Items.Count(x => x.Action.Contains("_document_", StringComparison.Ordinal)));
        Assert.Contains(audit.Items, x => x.Details.Contains("Téves melléklet") && x.ActorSubject == owner.User.Id);
        Assert.DoesNotContain(audit.Items, x => x.Details.Contains(Convert.ToBase64String(DocumentPdf)));
        var context = new TenantContext(); context.Set(company.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        var central = await db.SystemAuditEvents.Where(x => x.TenantId == company.Id && x.Action.Contains("_document_")).ToArrayAsync();
        Assert.Equal(3, central.Length);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Document_rights_follow_each_source_group_site_and_are_separate_from_vehicle_and_partner_rights(bool lease)
    {
        using var owner = await Register(); using var member = await Register(); var company = await Company(owner);
        var a = await ScopeSite(owner, "DA"); var b = await ScopeSite(owner, "DB");
        var itemA = await DocumentSetup(owner, lease, "DOC-A", a.Id); var itemB = await DocumentSetup(owner, lease, "DOC-B", b.Id); var unassigned = await DocumentSetup(owner, lease, "DOC-NONE");
        var docA = await ScopeOk<DocumentChange>(await SendDocument(owner, itemA, 1)); var docB = await ScopeOk<DocumentChange>(await SendDocument(owner, itemB, 1));
        var read = lease ? Permissions.LeasingRead : Permissions.ServicesRead; var write = lease ? Permissions.LeasingManage : Permissions.ServicesManage;
        var readA = await ScopedGroup(owner, "Dokumentumolvasó A", company.Id, [a.Id], read);
        var writeB = await ScopedGroup(owner, "Dokumentumfeltöltő B", company.Id, [b.Id], write);
        await CompanyAssign(owner, member.User.Id, readA.Id, writeB.Id); Select(member, company.Id);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(itemA.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync(itemA.Url + $"/{docA.Document.Id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(itemB.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.GetAsync(itemB.Url + $"/{docB.Document.Id}/content")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendDocument(member, itemA, 2)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SendDocument(member, itemB, 2)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendDocument(member, unassigned, 1)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await member.Client.PatchAsJsonAsync(itemA.Url + $"/{docA.Document.Id}/status", new DocumentStatusInput(true, "Nincs írási jog", 1, 2))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync("/api/v1/partners")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync(CarUrl(itemA.Car) + "/details")).StatusCode);
        using var vehicleOnly = await Register(); await Join(owner, vehicleOnly, company.Id, Permissions.VehiclesRead, Permissions.VehiclesUpdate);
        Assert.Equal(HttpStatusCode.Forbidden, (await vehicleOnly.Client.GetAsync(itemA.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendDocument(vehicleOnly, itemA, 2)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await vehicleOnly.Client.GetAsync(itemA.Url + $"/{docA.Document.Id}/content")).StatusCode);
    }

    [Fact]
    public async Task Invalid_and_oversize_files_missing_csrf_and_invalid_versions_never_persist_or_change_the_parent()
    {
        using var owner = await Register(); await Company(owner); var item = await DocumentSetup(owner, true);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendDocument(owner, item, 1, Encoding.ASCII.GetBytes("<html>bad</html>"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendDocument(owner, item, 1, name: "document.html")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendDocument(owner, item, 0)).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await SendDocument(owner, item, 1, [])).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await SendDocument(owner, item, 1, new byte[DocumentLimits.FileBytes + 1])).StatusCode);
        using (var malformed = new MultipartFormDataContent())
        {
            malformed.Add(new ByteArrayContent(DocumentPdf), "file", "a.pdf"); malformed.Add(new ByteArrayContent(DocumentPdf), "file", "b.pdf");
            malformed.Add(new StringContent("1"), "version");
            Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsync(item.Url, malformed)).StatusCode);
        }
        owner.Client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.BadRequest, (await SendDocument(owner, item, 1)).StatusCode);
        var list = (await owner.Client.GetFromJsonAsync<DocumentCollection>(item.Url))!;
        Assert.Empty(list.Items); Assert.Equal(1, list.ParentVersion); Assert.Equal(item.Car.Vehicle.Version, list.VehicleVersion);
    }

    private static byte[] OfficeDocument(bool word, bool macro = false)
    {
        using var memory = new MemoryStream();
        using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
        {
            var path = word ? "word/document.xml" : "xl/workbook.xml";
            using (var writer = new StreamWriter(zip.CreateEntry(path).Open())) writer.Write("<document/>");
            using (var writer = new StreamWriter(zip.CreateEntry("[Content_Types].xml").Open())) writer.Write($"""<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/{path}" ContentType="{(word ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")}"/></Types>""");
            if (macro) using (var writer = new StreamWriter(zip.CreateEntry("word/vbaProject.bin").Open())) writer.Write("macro");
        }
        return memory.ToArray();
    }
    [Fact]
    public async Task File_types_come_from_content_and_office_packages_reject_macros_and_renamed_zip_files()
    {
        using var owner = await Register(); await Company(owner); var item = await DocumentSetup(owner, false);
        var word = await ScopeOk<DocumentChange>(await SendDocument(owner, item, 1, OfficeDocument(true), "szerződés.docx"));
        Assert.Equal("application/vnd.openxmlformats-officedocument.wordprocessingml.document", word.Document.ContentType);
        var sheet = await ScopeOk<DocumentChange>(await SendDocument(owner, item, 2, OfficeDocument(false), "munkalap.xlsx"));
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sheet.Document.ContentType);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendDocument(owner, item, 3, OfficeDocument(true, true), "macro.docx")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendDocument(owner, item, 3, OfficeDocument(false), "wrong.docx")).StatusCode);
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzEAAAAASUVORK5CYII=");
        Assert.Equal("image/png", (await ScopeOk<DocumentChange>(await SendDocument(owner, item, 3, png, "fotó.PNG"))).Document.ContentType);
        Assert.Equal(3, (await owner.Client.GetFromJsonAsync<DocumentCollection>(item.Url))!.Items.Length);
    }

    [Fact]
    public async Task Document_writes_obey_vehicle_archival_and_service_voiding_while_previous_files_remain_readable()
    {
        using var owner = await Register(); await Company(owner); var lease = await DocumentSetup(owner, true); var service = await DocumentSetup(owner, false, "DOC-SERVICE");
        var leaseFile = await ScopeOk<DocumentChange>(await SendDocument(owner, lease, 1)); var serviceFile = await ScopeOk<DocumentChange>(await SendDocument(owner, service, 1));
        await ScopeOk<ServiceDetails>(await owner.Client.PostAsJsonAsync(CarUrl(service.Car) + $"/services/{service.Parent}/void", new VersionReason(2, "Téves szerviz")));
        Assert.Equal(HttpStatusCode.Conflict, (await SendDocument(owner, service, 3)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync(service.Url + $"/{serviceFile.Document.Id}/status", new DocumentStatusInput(true, "Visszavonás", 1, 3))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync(service.Url + $"/{serviceFile.Document.Id}/content")).StatusCode);
        await ScopeOk<VehicleRecord>(await owner.Client.PatchAsJsonAsync(CarUrl(lease.Car) + "/status", new VehicleStateInput(true, "Archiválás", leaseFile.VehicleVersion)));
        Assert.Equal(HttpStatusCode.Conflict, (await SendDocument(owner, lease, 2)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync(lease.Url + $"/{leaseFile.Document.Id}/status", new DocumentStatusInput(true, "Visszavonás", 1, 2))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.Client.GetAsync(lease.Url + $"/{leaseFile.Document.Id}/content")).StatusCode);
    }

    [Fact]
    public async Task Document_quotas_include_retained_history_and_restore_never_exceeds_the_active_limit()
    {
        using var owner = await Register(); await Company(owner); var item = await DocumentSetup(owner, true); DocumentChange first = null!;
        for (var i = 0; i < DocumentLimits.ActiveFiles; i++)
        {
            var doc = await ScopeOk<DocumentChange>(await SendDocument(owner, item, i + 1, name: $"doc-{i}.pdf"));
            if (i == 0) first = doc;
        }
        Assert.Equal(HttpStatusCode.Conflict, (await SendDocument(owner, item, 21)).StatusCode);
        var statusPath = item.Url + $"/{first.Document.Id}/status";
        await ScopeOk<DocumentChange>(await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(true, "Téves fájl", 1, 21)));
        await ScopeOk<DocumentChange>(await SendDocument(owner, item, 22));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PatchAsJsonAsync(statusPath, new DocumentStatusInput(false, "Vissza", 2, 23))).StatusCode);
        var files = (await owner.Client.GetFromJsonAsync<DocumentCollection>(item.Url))!;
        Assert.Equal(21, files.Items.Length); Assert.Equal(20, files.Items.Count(x => !x.IsWithdrawn)); Assert.Equal(DocumentPdf.Length * 21, files.TotalBytes);
    }

    [Fact]
    public async Task Permission_changes_during_upload_are_rechecked_before_any_file_or_parent_change_is_committed()
    {
        using var owner = await Register(); using var member = await Register(); var company = await Company(owner);
        var a = await ScopeSite(owner, "UA"); var b = await ScopeSite(owner, "UB"); var item = await DocumentSetup(owner, true, site: a.Id);
        var group = await ScopedGroup(owner, "Feltöltő", company.Id, [a.Id], Permissions.LeasingManage);
        await CompanyAssign(owner, member.User.Id, group.Id);
        var context = new TenantContext(); context.Set(company.Id, member.User.Id, [Permissions.LeasingManage]);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        var service = new FleetManagement(db, context);
        var error = await Assert.ThrowsAsync<ManagementException>(() => service.UploadDocument(item.Car.Vehicle.Id, item.Parent, true, async () =>
        {
            await ScopeOk<PermissionGroupSummary>(await owner.Client.PutAsJsonAsync($"/api/v1/permission-groups/{group.Id}",
                new UpdateGroupRequest(group.Name, group.Permissions, [company.Id], group.Version, SiteScopes: [new(company.Id, false, [b.Id])])));
            return new DocumentUpload("file.pdf", DocumentPdf, 1);
        }, default));
        Assert.Equal(404, error.StatusCode);
        var files = (await owner.Client.GetFromJsonAsync<DocumentCollection>(item.Url))!; Assert.Empty(files.Items); Assert.Equal(1, files.ParentVersion);
    }

    [Fact]
    public async Task Document_tables_have_force_rls_composite_parent_keys_and_immutable_contents_and_metadata()
    {
        using var owner = await Register(); using var foreign = await Register(); var company = await Company(owner); await Company(foreign);
        var item = await DocumentSetup(owner, true); var other = await DocumentSetup(foreign, true); var file = await ScopeOk<DocumentChange>(await SendDocument(owner, item, 1));
        await using (var unscoped = FleetFixture.CreateContext(fixture.ApplicationConnection, new TenantContext()))
        {
            Assert.Empty(await unscoped.VehicleDocuments.IgnoreQueryFilters().ToArrayAsync()); Assert.Empty(await unscoped.VehicleDocumentContents.IgnoreQueryFilters().ToArrayAsync());
        }
        var context = new TenantContext(); context.Set(company.Id, owner.User.Id, Permissions.All);
        await using var db = FleetFixture.CreateContext(fixture.ApplicationConnection, context);
        await Assert.ThrowsAnyAsync<Exception>(() => TenantTransaction.RunAsync(db, company.Id, async () => await db.VehicleDocumentContents.Where(x => x.DocumentId == file.Document.Id).ExecuteDeleteAsync(), default));
        await Assert.ThrowsAnyAsync<Exception>(() => TenantTransaction.RunAsync(db, company.Id, async () => await db.VehicleDocuments.Where(x => x.Id == file.Document.Id).ExecuteUpdateAsync(x => x.SetProperty(d => d.FileName, "changed.pdf")), default));
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => TenantTransaction.RunAsync(db, company.Id, async () =>
        {
            db.VehicleDocuments.Add(new() { TenantId = company.Id, LeaseId = other.Parent, FileName = "foreign.pdf", ContentType = "application/pdf", ByteLength = 1, Sha256 = new string('0', 64), UploadedBy = owner.User.Id });
            return await db.SaveChangesAsync();
        }, default));
        db.ChangeTracker.Clear();
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => TenantTransaction.RunAsync(db, company.Id, async () =>
        {
            db.VehicleDocuments.Add(new() { TenantId = company.Id, FileName = "no-parent.pdf", ContentType = "application/pdf", ByteLength = 1, Sha256 = new string('0', 64), UploadedBy = owner.User.Id });
            return await db.SaveChangesAsync();
        }, default));
    }
}
