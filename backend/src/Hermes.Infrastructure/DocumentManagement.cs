using System.Security.Cryptography;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class FleetManagement
{
    private static string DocumentPermission(bool lease, bool write, bool vehicle) => vehicle ? write ? Permissions.DocumentsManage : Permissions.DocumentsRead : lease
        ? write ? Permissions.LeasingManage : Permissions.LeasingRead
        : write ? Permissions.ServicesManage : Permissions.ServicesRead;
    private async Task<(Vehicle Car, VehicleLease? Lease, VehicleService? Service)> DocumentParent(Guid vehicleId, Guid parentId, bool lease,
        ResourceAccess access, bool write, CancellationToken ct, bool vehicle)
    {
        var car = await Car(vehicleId, access, DocumentPermission(lease, write, vehicle), ct, write);
        if (vehicle) return (car, null, null);
        var contract = lease ? await db.VehicleLeases.SingleOrDefaultAsync(x => x.Id == parentId && x.VehicleId == vehicleId, ct) : null;
        var service = !lease ? await db.VehicleServices.SingleOrDefaultAsync(x => x.Id == parentId && x.VehicleId == vehicleId, ct) : null;
        if (contract is null && service is null) throw Error(404, "document_parent_not_found", "A bejegyzés nem található ennél a járműnél.");
        if (write && service?.IsVoided == true) throw Error(409, "service_voided", "Érvénytelenített szervizbejegyzés dokumentumai nem módosíthatók.");
        return (car, contract, service);
    }
    private IQueryable<VehicleDocument> Documents(Guid parentId, bool lease, bool vehicle) => db.VehicleDocuments.Where(x => vehicle ? x.VehicleId == parentId : lease ? x.LeaseId == parentId : x.ServiceId == parentId);
    private static DocumentSummary DocumentDto(VehicleDocument x) => new(x.Id, x.FileName, x.ContentType, x.ByteLength, x.Sha256,
        x.UploadedBy, x.UploadedAt, x.Version, x.IsWithdrawn, x.StatusReason, x.StatusChangedBy, x.StatusChangedAt, x.Category);
    private static long ParentVersion((Vehicle Car, VehicleLease? Lease, VehicleService? Service) parent) => parent.Lease?.Version ?? parent.Service?.Version ?? parent.Car.Version;
    private void TouchDocumentParent((Vehicle Car, VehicleLease? Lease, VehicleService? Service) parent)
    {
        parent.Car.Version++;
        if (parent.Lease is { } lease) { lease.Version++; lease.UpdatedAt = DateTimeOffset.UtcNow; lease.UpdatedBy = Actor; }
        if (parent.Service is { } service) { service.Version++; service.UpdatedAt = DateTimeOffset.UtcNow; service.UpdatedBy = Actor; }
    }
    public Task<DocumentCollection> ListDocuments(Guid vehicleId, Guid parentId, bool lease, CancellationToken ct, bool vehicle = false) => Scoped(DocumentPermission(lease, false, vehicle), async access =>
    {
        var parent = await DocumentParent(vehicleId, parentId, lease, access, false, ct, vehicle);
        var documents = await Documents(vehicle ? vehicleId : parentId, lease, vehicle).AsNoTracking().OrderByDescending(x => x.UploadedAt).ThenByDescending(x => x.Id).ToArrayAsync(ct);
        return new DocumentCollection(documents.Select(DocumentDto).ToArray(), ParentVersion(parent), parent.Car.Version, documents.Sum(x => (long)x.ByteLength));
    }, ct);

    public async Task<DocumentChange> UploadDocument(Guid vehicleId, Guid parentId, bool lease, Func<Task<DocumentUpload>> read, CancellationToken ct, bool vehicle = false)
    {
        // Check before receiving the file, release locks during network I/O, then check again when committing.
        await Scoped(DocumentPermission(lease, true, vehicle), async access => { await DocumentParent(vehicleId, parentId, lease, access, true, ct, vehicle); return true; }, ct);
        db.ChangeTracker.Clear();
        var input = await read();
        var (name, type) = DocumentValidation.Validate(input);
        if (vehicle ? !VehicleDocumentCategories.IsValid(input.Category) : input.Category is not null)
            throw FleetValidation.Invalid("Válassz dokumentumtípust: forgalmi engedély, biztosítás vagy műszaki vizsga.");
        if (vehicle) parentId = vehicleId;
        var sha = Convert.ToHexStringLower(SHA256.HashData(input.Bytes));
        return await Scoped(DocumentPermission(lease, true, vehicle), async access =>
        {
            var parent = await DocumentParent(vehicleId, parentId, lease, access, true, ct, vehicle);
            FleetValidation.Revision(ParentVersion(parent), input.ParentVersion);
            var existing = await Documents(parentId, lease, vehicle).Select(x => new { x.ByteLength, x.IsWithdrawn }).ToArrayAsync(ct);
            if (existing.Length >= DocumentLimits.StoredFiles || existing.Count(x => !x.IsWithdrawn) >= DocumentLimits.ActiveFiles
                || existing.Sum(x => (long)x.ByteLength) + input.Bytes.Length > DocumentLimits.TotalBytes)
                throw Error(409, "document_quota", "A bejegyzés dokumentumtára megtelt: legfeljebb 20 aktív fájl, 100 tárolt fájl és összesen 100 MB engedélyezett.");
            var document = new VehicleDocument { TenantId = TenantId, VehicleId = vehicle ? vehicleId : null, Category = vehicle ? input.Category : null,
                LeaseId = !vehicle && lease ? parentId : null, ServiceId = !vehicle && !lease ? parentId : null,
                FileName = name, ContentType = type, ByteLength = input.Bytes.Length, Sha256 = sha, UploadedBy = Actor };
            db.VehicleDocuments.Add(document);
            db.VehicleDocumentContents.Add(new() { TenantId = TenantId, DocumentId = document.Id, Bytes = input.Bytes });
            TouchDocumentParent(parent);
            var result = new DocumentChange(DocumentDto(document), ParentVersion(parent), parent.Car.Version);
            Audit(vehicle ? "vehicle.document_uploaded" : lease ? "vehicle.lease_document_uploaded" : "vehicle.service_document_uploaded", document.Id, null, new { parentId, document = result.Document }, vehicleId);
            await db.SaveChangesAsync(ct);
            return result;
        }, ct);
    }
    public Task<DocumentDownload> DownloadDocument(Guid vehicleId, Guid parentId, bool lease, Guid id, CancellationToken ct, bool vehicle = false) => Scoped(DocumentPermission(lease, false, vehicle), async access =>
    {
        await DocumentParent(vehicleId, parentId, lease, access, false, ct, vehicle);
        var doc = await Documents(vehicle ? vehicleId : parentId, lease, vehicle).AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.IsWithdrawn, ct)
            ?? throw Error(404, "document_not_found", "A dokumentum nem található vagy visszavonták.");
        var bytes = await db.VehicleDocumentContents.AsNoTracking().Where(x => x.DocumentId == id).Select(x => x.Bytes).SingleAsync(ct);
        return new DocumentDownload(doc.FileName, doc.ContentType, bytes);
    }, ct);
    public Task<DocumentChange> DocumentStatus(Guid vehicleId, Guid parentId, bool lease, Guid id, DocumentStatusInput input, CancellationToken ct, bool vehicle = false) => Scoped(DocumentPermission(lease, true, vehicle), async access =>
    {
        if (vehicle) parentId = vehicleId;
        var parent = await DocumentParent(vehicleId, parentId, lease, access, true, ct, vehicle);
        var doc = await Documents(parentId, lease, vehicle).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw Error(404, "document_not_found", "A dokumentum nem található.");
        FleetValidation.Revision(ParentVersion(parent), input.ParentVersion); FleetValidation.Revision(doc.Version, input.Version);
        if (input.IsWithdrawn is null) throw FleetValidation.Invalid("Add meg a dokumentum kívánt állapotát.");
        var reason = OrganizationValidation.Reason(input.Reason);
        if (doc.IsWithdrawn == input.IsWithdrawn) return new DocumentChange(DocumentDto(doc), ParentVersion(parent), parent.Car.Version);
        if (input.IsWithdrawn == false && await Documents(parentId, lease, vehicle).CountAsync(x => !x.IsWithdrawn, ct) >= DocumentLimits.ActiveFiles)
            throw Error(409, "document_quota", "A bejegyzéshez legfeljebb 20 aktív dokumentum tartozhat.");
        var before = DocumentDto(doc);
        doc.IsWithdrawn = input.IsWithdrawn.Value; doc.StatusReason = reason; doc.StatusChangedAt = DateTimeOffset.UtcNow; doc.StatusChangedBy = Actor; doc.Version++;
        TouchDocumentParent(parent);
        var result = new DocumentChange(DocumentDto(doc), ParentVersion(parent), parent.Car.Version);
        Audit(vehicle ? "vehicle.document_status_changed" : lease ? "vehicle.lease_document_status_changed" : "vehicle.service_document_status_changed", id, new { parentId, document = before }, new { parentId, document = result.Document }, vehicleId);
        await db.SaveChangesAsync(ct);
        return result;
    }, ct);
}
