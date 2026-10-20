namespace Hermes.Application;

public static class DocumentLimits
{
    public const int FileBytes = 10 * 1024 * 1024;
    public const int RequestBytes = 12 * 1024 * 1024;
    public const int ActiveFiles = 20;
    public const int StoredFiles = 100;
    public const long TotalBytes = 100 * 1024 * 1024;
}
public sealed record DocumentSummary(Guid Id, string FileName, string ContentType, int ByteLength, string Sha256,
    string UploadedBy, DateTimeOffset UploadedAt, long Version, bool IsWithdrawn, string? StatusReason,
    string? StatusChangedBy, DateTimeOffset? StatusChangedAt);
public sealed record DocumentCollection(DocumentSummary[] Items, long ParentVersion, long VehicleVersion, long TotalBytes);
public sealed record DocumentChange(DocumentSummary Document, long ParentVersion, long VehicleVersion);
public sealed record DocumentStatusInput(bool? IsWithdrawn, string Reason, long Version, long ParentVersion);
public sealed record DocumentUpload(string FileName, byte[] Bytes, long ParentVersion);
public sealed record DocumentDownload(string FileName, string ContentType, byte[] Bytes);
