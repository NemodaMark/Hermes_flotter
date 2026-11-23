using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using Hermes.Application;

namespace Hermes.Infrastructure;

// Reads cached OOXML cells only. Never executes formulas, macros, external links or archive programs.
public static class LegacyFuelSettlementReader
{
    public sealed record Item(LegacySettlementRow Row, byte[] Workbook);
    private static readonly XNamespace Ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly string[] Months = ["Január", "Február", "Március", "Április", "Május", "Június", "Július", "Augusztus", "Szeptember", "Október", "November", "December"];
    public static Item[] Read(byte[] bytes, string fileName, int year)
    {
        if (bytes.Length > 100 * 1024 * 1024 || year is < 1900 or > 2100) throw FleetValidation.Invalid("Legfeljebb 100 MB-os fájlt és érvényes évet adj meg.");
        try
        {
            if (fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) return ReadBook(bytes, Path.GetFileName(fileName), year);
            if (!fileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) throw FleetValidation.Invalid("XLSX vagy ZIP fájlt válassz.");
            using var archive = new ZipArchive(new MemoryStream(bytes));
            if (archive.Entries.Count > 3000 || archive.Entries.Sum(x => x.Length) > 150L * 1024 * 1024) throw FleetValidation.Invalid("Túl nagy archívum.");
            var result = new List<Item>();
            foreach (var entry in archive.Entries)
            {
                var name = entry.FullName.Replace('\\', '/'); var parts = name.Split('/');
                if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || !parts.Contains(year.ToString(CultureInfo.InvariantCulture)) || entry.Length == 0
                    || Path.GetFileName(name).StartsWith("~$", StringComparison.Ordinal)) continue;
                if (entry.Length > 8 * 1024 * 1024 || result.Count > 1200) throw FleetValidation.Invalid("Túl nagy Excel-állomány.");
                using var content = new MemoryStream(); using (var stream = entry.Open()) stream.CopyTo(content);
                result.AddRange(ReadBook(content.ToArray(), name, year));
            }
            var groups = result.GroupBy(x => (x.Row.Registration, x.Row.Month)).Where(x => x.Count() > 1).Select(x => x.Key).ToHashSet();
            return result.Select(x => groups.Contains((x.Row.Registration, x.Row.Month))
                ? x with { Row = x.Row with { Warnings = [.. x.Row.Warnings, "Több forrás tartozik ehhez az autóhoz és hónaphoz; válaszd ki az érvényes példányt."] } } : x).ToArray();
        }
        catch (Exception e) when (e is InvalidDataException or XmlException or FormatException or OverflowException or ArgumentException)
        { throw FleetValidation.Invalid("A fájl sérült vagy nem támogatott Excel-állomány."); }
    }
    private static XDocument Xml(ZipArchive archive, string name)
    {
        var entry = archive.GetEntry(name) ?? throw new InvalidDataException("Missing XML");
        if (entry.Length > 16 * 1024 * 1024) throw new InvalidDataException("Oversized XML");
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new() { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 16 * 1024 * 1024 });
        return XDocument.Load(reader);
    }
    private static Item[] ReadBook(byte[] bytes, string name, int year)
    {
        using var zip = new ZipArchive(new MemoryStream(bytes));
        if (zip.Entries.Count > 1500 || zip.Entries.Sum(x => x.Length) > 32L * 1024 * 1024) throw new InvalidDataException("Oversized workbook");
        var workbook = Xml(zip, "xl/workbook.xml"); var rels = Xml(zip, "xl/_rels/workbook.xml.rels");
        var shared = zip.GetEntry("xl/sharedStrings.xml") is null ? [] : Xml(zip, "xl/sharedStrings.xml").Descendants(Ns + "si").Select(x => string.Concat(x.Descendants(Ns + "t").Select(t => t.Value))).ToArray();
        var targets = rels.Root!.Elements().Where(x => (string?)x.Attribute("TargetMode") != "External")
            .ToDictionary(x => (string)x.Attribute("Id")!, x => (string)x.Attribute("Target")!);
        var result = new List<Item>(); var hash = Convert.ToHexString(SHA256.HashData(bytes));
        foreach (var sheet in workbook.Descendants(Ns + "sheet"))
        {
            var title = (string)sheet.Attribute("name")!; var monthIndex = Array.IndexOf(Months, title);
            if (monthIndex < 0) continue;
            var relation = sheet.Attributes().FirstOrDefault(x => x.Name.LocalName == "id")?.Value;
            if (relation is null || !targets.TryGetValue(relation, out var target)) continue;
            var file = target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target;
            if (file.Contains("..", StringComparison.Ordinal)) throw new InvalidDataException("Invalid sheet path");
            var cells = Xml(zip, file).Descendants(Ns + "c").ToDictionary(x => (string)x.Attribute("r")!, x => x);
            string? Text(string cell)
            {
                if (!cells.TryGetValue(cell, out var c)) return null;
                var value = c.Element(Ns + "v")?.Value;
                return (string?)c.Attribute("t") switch {
                    "s" => value is not null && int.TryParse(value, out var i) && i >= 0 && i < shared.Length ? shared[i] : null,
                    "inlineStr" => string.Concat(c.Descendants(Ns + "t").Select(x => x.Value)), "e" => null, _ => value };
            }
            decimal? Number(string cell) => decimal.TryParse(Text(cell), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : null;
            if (Text("A30") != "Üzemanyag összesen" || Number("D28") is not { } end || Number("D5") is not { } start || end <= start) continue;
            var registration = FleetManagement.NormalizeRegistration(Text("B4") ?? "");
            var warnings = new List<string>(); var privateKm = Number("C40"); var price = Number("C38");
            if (privateKm is null) warnings.Add("Hiányzik a magánkilométer.");
            if (privateKm > end - start) warnings.Add("A magánkilométer nagyobb a teljes futásnál.");
            var free = Number("B5"); var rate1 = Number("F3"); var rate2 = Number("G3");
            if (free is null || rate1 is null || rate2 is null) { warnings.Add("Hiányoznak az elszámolási szabályok."); continue; }
            if (privateKm > free && price is null) warnings.Add("Hiányzik az üzemanyagár.");
            var formula = cells.GetValueOrDefault("C42")?.Element(Ns + "f")?.Value;
            if (formula != "IF(F6=0,0,((((C40-B5)/100)*C34)*C38)+(F6*F3)+(G6*G3))") warnings.Add("Egyedi vagy kézzel megadott díjképlet.");
            decimal liters = 0;
            for (var row = 8; row <= 28; row++) liters += Number("C" + row) ?? 0;
            var actualYear = year;
            if (double.TryParse(Text("B1"), CultureInfo.InvariantCulture, out var serial) && serial is > 1 and < 100000)
                actualYear = DateTime.FromOADate(serial + ((string?)workbook.Root?.Element(Ns + "workbookPr")?.Attribute("date1904") == "1" ? 1462 : 0)).Year;
            if (actualYear != year) { warnings.Add("Az Excel belső éve eltér a kiválasztott évtől."); continue; }
            var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(name + "\n" + hash + "\n" + title)));
            result.Add(new(new(id, name, title, new(year, monthIndex + 1, 1), registration, Text("B2"), start, end, liters,
                privateKm, price, new(free.Value, 500, rate1.Value, rate2.Value), Number("C42"), formula, warnings.ToArray()), bytes));
        }
        return result.ToArray();
    }
}
