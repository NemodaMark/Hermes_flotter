namespace Hermes.Domain;

public static class VehicleDocumentCategories
{
    public const string Registration = "Registration";
    public const string Insurance = "Insurance";
    public const string Inspection = "Inspection";
    public static bool IsValid(string? value) => value is Registration or Insurance or Inspection;
}

public sealed class VehicleDocument : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid? LeaseId { get; init; }
    public Guid? ServiceId { get; init; }
    public Guid? VehicleId { get; init; }
    public string? Category { get; init; }
    public required string FileName { get; init; }
    public required string ContentType { get; init; }
    public int ByteLength { get; init; }
    public required string Sha256 { get; init; }
    public required string UploadedBy { get; init; }
    public DateTimeOffset UploadedAt { get; init; } = DateTimeOffset.UtcNow;
    public long Version { get; set; } = 1;
    public bool IsWithdrawn { get; set; }
    public string? StatusReason { get; set; }
    public string? StatusChangedBy { get; set; }
    public DateTimeOffset? StatusChangedAt { get; set; }
}

// Separate from metadata so listing files never loads their contents.
public sealed class VehicleDocumentContent : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid DocumentId { get; init; }
    public required byte[] Bytes { get; init; }
}
