using System.Security.Cryptography;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

internal sealed partial class CsvImportCompany
{
    private readonly Dictionary<(string Kind, string Reference), CsvImportRow> inlineImages = [];

    private void PrepareFiles()
    {
        Each("files", row =>
        {
            var kind = row.Require("owner_kind");
            var reference = row.Require("owner_ref");
            if (kind is "fuel_receipt" or "handover_photo"
                && !inlineImages.TryAdd((kind, reference), row))
                throw row.Error("Egy tankoláshoz vagy átadáshoz legfeljebb egy kép tartozhat.");
        });
    }

    private byte[]? InlineImage(string kind, string reference)
    {
        if (!inlineImages.Remove((kind, reference), out var row)) return null;
        return CsvImport.ReadRow(row, () =>
        {
            var data = FileMetadata(row, photo: true);
            if (data.Slot is not null) throw row.Error("A slot csak járműfotóhoz adható meg.");
            var normalized = ReadImage(package, row, data, avatar: false);
            Audit("data.csv_image_imported", reference, users.Actor(row, "uploaded_by_ref"), data.At,
                new { kind, sourceFile = row.Require("file_ref"), data.Name, sourceSha256 = row.Require("sha256") });
            return normalized;
        });
    }

    private async Task ImportAttachments(CancellationToken ct)
    {
        if (inlineImages.Count != 0)
            throw inlineImages.Values.First().Error("A tankolási vagy átadási hivatkozás nem létezik ebben a cégben.");
        var albums = new Dictionary<Guid, HashSet<int>>();
        var quotas = new Dictionary<(string, Guid), (int Count, int Active, long Bytes)>();
        foreach (var row in Rows("files"))
        {
            ct.ThrowIfCancellationRequested();
            var kind = row.Require("owner_kind");
            if (kind is "fuel_receipt" or "handover_photo") continue;
            CsvImport.ReadRow(row, () =>
            {
                var data = FileMetadata(row, photo: kind == "vehicle_photo");
                if (kind == "vehicle_photo") AddPhoto(row, data, albums);
                else AddDocument(row, kind, data, quotas);
                return true;
            });
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }
    }

    private void AddPhoto(CsvImportRow row, ImportedFile data, Dictionary<Guid, HashSet<int>> albums)
    {
        var vehicle = Find(vehicles, row, "owner_ref").Vehicle.Id;
        if (!albums.TryGetValue(vehicle, out var slots)) albums.Add(vehicle, slots = []);
        var slot = data.Slot ?? Enumerable.Range(1, 5).FirstOrDefault(i => !slots.Contains(i));
        if (slot is < 1 or > 5 || !slots.Add(slot)) throw row.Error("A járműhöz legfeljebb öt, külön sorszámú kép tartozhat.");
        var bytes = ReadImage(package, row, data, avatar: false);
        db.VehiclePhotos.Add(new() { TenantId = TenantId, VehicleId = vehicle, Slot = slot, Bytes = bytes,
            Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)), UploadedAt = data.At, UploadedBy = users.Actor(row, "uploaded_by_ref") });
    }

    private void AddDocument(CsvImportRow row, string kind, ImportedFile data,
        Dictionary<(string, Guid), (int Count, int Active, long Bytes)> quotas)
    {
        var parent = kind switch
        {
            "vehicle_document" => Find(vehicles, row, "owner_ref").Vehicle.Id,
            "lease_document" => Find(leases, row, "owner_ref").Id,
            "service_document" => Find(services, row, "owner_ref").Id,
            _ => throw row.Error("Ismeretlen owner_kind.")
        };
        if (kind == "vehicle_document" ? !VehicleDocumentCategories.IsValid(data.Category) : data.Category is not null)
            throw row.Error("A kategória járműokmánynál Registration, Insurance vagy Inspection. Szerződésnél és szerviznél üres.");
        if (data.Slot is not null) throw row.Error("A slot csak járműfotóhoz adható meg.");
        var bytes = package.Attachment(row, DocumentLimits.FileBytes);
        var (name, type) = DocumentValidation.Validate(new(data.Name, bytes, 1, data.Category));
        if (data.Type is not null && !data.Type.Equals(type, StringComparison.OrdinalIgnoreCase))
            throw row.Error("A dokumentum típusa eltér a jegyzékben megadott típustól.");
        var key = (kind, parent);
        var (count, active, size) = quotas.GetValueOrDefault(key);
        count++;
        if (!data.Withdrawn) active++;
        size += bytes.Length;
        if (count > DocumentLimits.StoredFiles || active > DocumentLimits.ActiveFiles || size > DocumentLimits.TotalBytes)
            throw row.Error("A dokumentumtár túllépi a szülőrekordhoz tartozó fájl- vagy méretkorlátot.");
        quotas[key] = (count, active, size);
        var document = new VehicleDocument
        {
            TenantId = TenantId, VehicleId = kind == "vehicle_document" ? parent : null, LeaseId = kind == "lease_document" ? parent : null,
            ServiceId = kind == "service_document" ? parent : null, Category = data.Category, FileName = name, ContentType = type,
            ByteLength = bytes.Length, Sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)), UploadedBy = users.Actor(row, "uploaded_by_ref"),
            UploadedAt = data.At, IsWithdrawn = data.Withdrawn, StatusReason = data.Reason, StatusChangedAt = data.ChangedAt,
            StatusChangedBy = users.OptionalActor(row, "status_changed_by_ref")
        };
        db.VehicleDocuments.Add(document);
        db.VehicleDocumentContents.Add(new() { TenantId = TenantId, DocumentId = document.Id, Bytes = bytes });
    }

    internal static ImportedFile FileMetadata(CsvImportRow row, bool photo)
    {
        var name = row.Require("original_name");
        if (name.Length > 180 || name.Any(char.IsControl)) throw row.Error("Érvénytelen vagy túl hosszú original_name.");
        var category = row.Field("category", 32);
        var withdrawn = row.Bool("is_withdrawn", false);
        var reason = row.Field("status_reason", 500);
        var changedAt = row.Time("status_changed_at");
        if (photo && (category is not null || withdrawn || reason is not null || changedAt is not null || row.Text("status_changed_by_ref") is not null))
            throw row.Error("A kategória és a visszavonási adatok dokumentumhoz tartoznak.");
        return new(name, row.Field("content_type", 100), category, row.Int("slot"), row.Time("uploaded_at") ?? DateTimeOffset.UtcNow, withdrawn, reason, changedAt);
    }

    internal static byte[] ReadImage(CsvImportPackage package, CsvImportRow row, ImportedFile file, bool avatar)
    {
        var bytes = package.Attachment(row, ImageProcessing.MaxBytes);
        if (file.Type is { } type)
        {
            var actual = bytes.Length > 0 && bytes[0] == 255 ? "image/jpeg" : "image/png";
            if (!type.Equals(actual, StringComparison.OrdinalIgnoreCase)) throw row.Error("A kép típusa eltér a jegyzéktől.");
        }
        return ImageProcessing.Normalize(new(bytes, file.Name, 1), avatar);
    }
}

internal sealed record ImportedFile(string Name, string? Type, string? Category, int? Slot, DateTimeOffset At,
    bool Withdrawn, string? Reason, DateTimeOffset? ChangedAt);
