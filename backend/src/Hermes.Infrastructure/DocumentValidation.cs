using System.IO.Compression;
using System.Xml;
using Hermes.Application;

namespace Hermes.Infrastructure;

internal static class DocumentValidation
{
    internal static (string Name, string Type) Validate(DocumentUpload input)
    {
        if (input.Bytes.Length is < 1 or > DocumentLimits.FileBytes)
            throw UserAccounts.Error(413, "document_size", "A fájl mérete 1 bájt és 10 MB közötti lehet.");
        var name = (input.FileName ?? "").Replace('\\', '/').Split('/').Last().Trim();
        if (name.Length is < 1 or > 180 || name.Any(char.IsControl))
            throw FleetValidation.Invalid("A fájlnév 1–180 karakter lehet, vezérlőkarakter nélkül.");
        var extension = Path.GetExtension(name).ToLowerInvariant();
        var bytes = input.Bytes.AsSpan();
        var type = extension switch
        {
            ".pdf" when bytes.StartsWith("%PDF-"u8) && bytes.Length >= 8 => "application/pdf",
            ".png" when bytes.StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) && bytes.Length >= 33 => "image/png",
            ".jpg" or ".jpeg" when bytes.StartsWith(new byte[] { 255, 216, 255 }) && bytes.Length >= 4 && bytes[^2] == 255 && bytes[^1] == 217 => "image/jpeg",
            ".docx" when Office(input.Bytes, true) => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xlsx" when Office(input.Bytes, false) => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _ => throw UserAccounts.Error(400, "document_type", "PDF-, JPG-, PNG-, DOCX- vagy XLSX-fájlt válassz. A fájl tartalmának is meg kell felelnie a kiterjesztésnek.")
        };
        return (name, type);
    }
    private static bool Office(byte[] bytes, bool word)
    {
        try
        {
            using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            if (archive.Entries.Count > 2048 || archive.Entries.Any(x => x.Length > 100 * 1024 * 1024L || x.FullName.EndsWith("vbaProject.bin", StringComparison.OrdinalIgnoreCase))
                || archive.Entries.Sum(x => (decimal)x.Length) > 100 * 1024 * 1024L) return false;
            var main = word ? "word/document.xml" : "xl/workbook.xml";
            var contentType = word ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
            if (archive.GetEntry(main) is not { Length: > 0 } || archive.GetEntry("[Content_Types].xml") is not { Length: > 0 and <= 65536 } types) return false;
            using var stream = types.Open();
            using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 65536 });
            var found = false;
            while (reader.Read())
            {
                if (reader.NodeType != XmlNodeType.Element) continue;
                var type = reader.GetAttribute("ContentType");
                if (type?.Contains("macroEnabled", StringComparison.OrdinalIgnoreCase) == true) return false;
                if (reader.LocalName == "Override" && reader.NamespaceURI == "http://schemas.openxmlformats.org/package/2006/content-types"
                    && reader.GetAttribute("PartName") == "/" + main && type == contentType) found = true;
            }
            return found;
        }
        catch (Exception e) when (e is InvalidDataException or XmlException or IOException or NotSupportedException or ArgumentException) { return false; }
    }
}
