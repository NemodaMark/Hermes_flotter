using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Microsoft.VisualBasic.FileIO;

namespace Hermes.Infrastructure;

internal sealed class CsvImportPackage : IDisposable
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly string[] Tables =
    [
        "companies", "company_contacts", "sites", "users", "memberships", "member_permissions", "groups",
        "group_companies", "group_sites", "group_permissions", "group_users", "admin_companies", "partners",
        "partner_contacts", "vehicles", "registrations", "odometer", "vehicle_users", "leases", "services",
        "booking_settings", "bookings", "service_appointments", "fuel_entries", "handovers", "files",
        "audit_events", "invitations"
    ];
    private readonly Dictionary<string, Func<Stream>> entries = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CsvImportRow[]> data = new(StringComparer.Ordinal);
    private readonly ZipArchive? archive;

    public CsvImportPackage(string path, CancellationToken ct)
    {
        try
        {
            if (Directory.Exists(path)) ReadDirectory(path);
            else
            {
                archive = ZipFile.OpenRead(path);
                var files = archive.Entries.Where(entry => !entry.FullName.EndsWith('/')).ToArray();
                foreach (var entry in files) ValidatePath(entry.FullName);
                var root = files.FirstOrDefault(entry => entry.FullName == "companies.csv");
                var companies = root ?? files.FirstOrDefault(entry => entry.FullName.EndsWith("/companies.csv", StringComparison.Ordinal)
                    && entry.FullName.Count(ch => ch == '/') == 1);
                var prefix = companies?.FullName[..^"companies.csv".Length] ?? "";
                foreach (var entry in files)
                {
                    if (!entry.FullName.StartsWith(prefix, StringComparison.Ordinal))
                        throw new InvalidDataException("A ZIP a csomagon kívüli fájlt is tartalmaz.");
                    AddEntry(entry.FullName[prefix.Length..], entry.Open);
                }
            }
            using var fingerprint = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            foreach (var name in Tables.Order(StringComparer.Ordinal))
            {
                ct.ThrowIfCancellationRequested();
                if (!entries.TryGetValue(name + ".csv", out var open)) continue;
                using var stream = open();
                var bytes = ReadLimited(stream, 64 * 1024 * 1024);
                fingerprint.AppendData(Utf8.GetBytes(name + "\n"));
                fingerprint.AppendData(SHA256.HashData(bytes));
                data.Add(name, ReadRows(name, bytes, ct));
            }
            Fingerprint = Convert.ToHexStringLower(fingerprint.GetHashAndReset());
            if (Rows("companies").Length == 0) throw new InvalidDataException("A companies.csv legalább egy céget tartalmazzon.");
            var manifestFiles = Rows("files").Select(x => x.AttachmentPath()).ToHashSet(StringComparer.Ordinal);
            foreach (var file in entries.Keys.Where(x => x.StartsWith("files/", StringComparison.Ordinal)))
                if (!manifestFiles.Contains(file)) throw new InvalidDataException($"A fájl hiányzik a files.csv jegyzékből: {file}");
        }
        catch
        {
            archive?.Dispose();
            throw;
        }
    }

    public string Fingerprint { get; }
    public IReadOnlyDictionary<string, int> Counts => data.ToDictionary(pair => pair.Key, pair => pair.Value.Length, StringComparer.Ordinal);
    public static bool IsCompanyScoped(string table) => table is not ("users" or "groups" or "group_users" or "group_permissions");
    public CsvImportRow[] Rows(string name) => data.GetValueOrDefault(name) ?? [];

    private void AddEntry(string name, Func<Stream> open)
    {
        ValidatePath(name);
        if (!name.StartsWith("files/", StringComparison.Ordinal) && name != "export_meta.json"
            && !Tables.Any(table => name == table + ".csv"))
            throw new InvalidDataException($"Ismeretlen fájl az importcsomagban: {name}");
        if (!entries.TryAdd(name, open)) throw new InvalidDataException($"Ismétlődő fájl az importcsomagban: {name}");
    }

    private void ReadDirectory(string path)
    {
        var enumeration = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint };
        foreach (var file in Directory.EnumerateFiles(path, "*", enumeration))
        {
            var name = Path.GetRelativePath(path, file).Replace(Path.DirectorySeparatorChar, '/');
            AddEntry(name, () => File.OpenRead(file));
        }
    }

    internal static void ValidatePath(string path)
    {
        if (path.Contains('\\') || path.Contains(':') || path.Any(char.IsControl)
            || path.Split('/').Any(part => part is "" or "." or ".."))
            throw new InvalidDataException("Érvénytelen relatív útvonal az importcsomagban.");
    }

    public byte[] Attachment(CsvImportRow row, int limit)
    {
        var path = row.AttachmentPath();
        if (!entries.TryGetValue(path, out var open)) throw row.Error($"Hiányzó csatolmány: {path}");
        using var stream = open();
        byte[] bytes;
        try { bytes = ReadLimited(stream, limit); }
        catch (InvalidDataException error) { throw row.Error(error.Message); }
        if (!long.TryParse(row.Require("byte_length"), NumberStyles.None, CultureInfo.InvariantCulture, out var length)
            || bytes.LongLength != length)
            throw row.Error("A fájlméret eltér a jegyzékben szereplőtől.");
        var sha = Convert.ToHexStringLower(SHA256.HashData(bytes));
        if (!sha.Equals(row.Require("sha256"), StringComparison.OrdinalIgnoreCase))
            throw row.Error("A fájl SHA-256 lenyomata eltér a jegyzékben szereplőtől.");
        return bytes;
    }

    private static byte[] ReadLimited(Stream stream, int limit)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        for (int read; (read = stream.Read(chunk)) != 0;)
        {
            if (buffer.Length + read > limit) throw new InvalidDataException($"A fájl meghaladja a {limit / (1024 * 1024)} MiB korlátot.");
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private static CsvImportRow[] ReadRows(string file, byte[] bytes, CancellationToken ct)
    {
        using var source = new MemoryStream(bytes, writable: false);
        using var parser = new TextFieldParser(source, Utf8, detectEncoding: false)
        {
            TextFieldType = FieldType.Delimited, HasFieldsEnclosedInQuotes = true, TrimWhiteSpace = false
        };
        parser.SetDelimiters(",");
        try
        {
            var headers = parser.ReadFields();
            if (headers is null) throw new InvalidDataException($"{file}.csv: Hiányzik a CSV fejléce.");
            headers = headers.Select(x => x.Trim().TrimStart('\ufeff')).ToArray();
            if (headers.Any(string.IsNullOrWhiteSpace) || headers.Distinct(StringComparer.Ordinal).Count() != headers.Length)
                throw new InvalidDataException($"{file}.csv: Üres vagy ismétlődő oszlopnév.");
            var rows = new List<CsvImportRow>();
            while (!parser.EndOfData)
            {
                ct.ThrowIfCancellationRequested();
                var line = parser.LineNumber;
                var fields = parser.ReadFields()!;
                if (fields.Length != headers.Length) throw new InvalidDataException($"{file}.csv:{line}: Az oszlopszám eltér a fejléctől.");
                if (fields.Any(field => field.Contains('\0'))) throw new InvalidDataException($"{file}.csv:{line}: Érvénytelen null karakter.");
                rows.Add(new(file, line, headers.Zip(fields).ToDictionary(pair => pair.First, pair => pair.Second, StringComparer.Ordinal)));
            }
            return rows.ToArray();
        }
        catch (MalformedLineException error) { throw new InvalidDataException($"{file}.csv:{error.LineNumber}: Hibás CSV idézőjelezés.", error); }
        catch (DecoderFallbackException error) { throw new InvalidDataException($"{file}.csv: A fájl nem UTF-8 kódolású.", error); }
    }

    public void Dispose() => archive?.Dispose();
}

internal sealed class CsvImportRow(string file, long line, Dictionary<string, string> fields)
{
    private readonly HashSet<string> consumed = new(StringComparer.Ordinal);
    public string File => file;
    public long Line => line;
    public bool HasUnread(string key) => !consumed.Contains(key) && !string.IsNullOrWhiteSpace(fields.GetValueOrDefault(key));
    public string? Text(string key)
    {
        consumed.Add(key);
        var value = fields.GetValueOrDefault(key)?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }

    public string Require(string key) => Text(key) ?? throw Error($"Kötelező mező: {key}.");
    public string? Field(string key, int max) => FleetValidation.Text(Text(key), max, key);
    public bool Bool(string key, bool? fallback = null) => Text(key) switch
    {
        "true" => true,
        "false" => false,
        null when fallback.HasValue => fallback.Value,
        _ => throw Error($"{key}: true vagy false érték szükséges.")
    };
    public int? Int(string key) => Parse<int>(key, int.TryParse, NumberStyles.AllowLeadingSign);
    public long? Long(string key) => Parse<long>(key, long.TryParse, NumberStyles.AllowLeadingSign);
    public decimal? Decimal(string key) => Parse<decimal>(key, decimal.TryParse, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint);
    private delegate bool Parser<T>(string value, NumberStyles style, IFormatProvider? culture, out T parsed);
    private T? Parse<T>(string key, Parser<T> parse, NumberStyles style) where T : struct =>
        Text(key) is not { } value ? null : parse(value, style, CultureInfo.InvariantCulture, out var number)
            ? number : throw Error($"{key}: Érvénytelen számformátum.");

    public DateOnly? Date(string key)
    {
        if (Text(key) is not { } value) return null;
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw Error($"{key}: ÉÉÉÉ-HH-NN dátum szükséges.");
        FleetValidation.Date(date);
        return date;
    }

    public DateTimeOffset? Time(string key)
    {
        if (Text(key) is not { } value) return null;
        if (!DateTimeOffset.TryParseExact(value, ["yyyy-MM-dd'T'HH:mm:ssK", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK"],
                CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
            || !(value.EndsWith('Z') || value.Length > 19 && value[^6] is '+' or '-'))
            throw Error($"{key}: ISO dátum és idő szükséges időzónaeltolással vagy Z jelöléssel.");
        return time.ToUniversalTime();
    }

    public Guid? Uuid(string key) => Text(key) is not { } value ? null
        : Guid.TryParseExact(value, "D", out var id) && id != Guid.Empty ? id : throw Error($"{key}: UUID szükséges.");
    public string AttachmentPath()
    {
        var path = Require("relative_path");
        CsvImportPackage.ValidatePath(path);
        if (!path.StartsWith("files/", StringComparison.Ordinal)) throw Error("A csatolmány a files/ könyvtárban legyen.");
        return path;
    }
    public void VerifyColumns()
    {
        var extra = fields.Where(pair => !string.IsNullOrWhiteSpace(pair.Value) && !consumed.Contains(pair.Key)).Select(pair => pair.Key).ToArray();
        if (extra.Length > 0) throw Error($"Nem támogatott mező: {string.Join(", ", extra)}.");
    }
    public InvalidDataException Error(string message) => new($"{file}.csv:{line}: {message}");
}
