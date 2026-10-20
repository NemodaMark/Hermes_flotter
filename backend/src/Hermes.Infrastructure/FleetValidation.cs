using System.Text.RegularExpressions;
using Hermes.Application;

namespace Hermes.Infrastructure;

internal static partial class FleetValidation
{
    internal static ManagementException Invalid(string message) => UserAccounts.Error(400, "invalid_fleet_data", message);
    internal static string? Text(string? value, int length, string label, bool required = false) => OrganizationValidation.Text(value, length, label, required);
    internal static string? Url(string? value)
    {
        var text = Text(value, 2048, "Webcím");
        if (text is not null && (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)))
            throw Invalid("Teljes http:// vagy https:// webcímet adj meg.");
        return text;
    }
    internal static string Choice(string? value, string label, params string[] choices)
        => choices.Contains(value, StringComparer.Ordinal) ? value! : throw Invalid($"{label}: válassz egy érvényes értéket.");
    internal static void Range(decimal? value, decimal max, string label, int decimals = 0)
    {
        if (value < 0 || value > max || value is { } x && decimal.Round(x, decimals) != x) throw Invalid($"{label}: 0 és {max} közötti, legfeljebb {decimals} tizedesjegyes számot adj meg.");
    }
    internal static void Date(DateOnly? date)
    {
        if (date is { Year: < 1900 or > 2100 }) throw Invalid("A dátum 1900 és 2100 közötti lehet.");
    }
    internal static string Currency(string? value)
    {
        var code = value?.Trim().ToUpperInvariant() ?? "";
        return CurrencyCode().IsMatch(code) ? code : throw Invalid("Hárombetűs pénznemkódot adj meg.");
    }
    internal static void Revision(long actual, long requested)
    {
        if (requested < 1) throw Invalid("Add meg az aktuális adatverziót.");
        if (actual != requested) throw UserAccounts.Error(409, "stale_fleet", "Az adat időközben megváltozott. Töltsd be újra a friss változatot.");
    }
    internal static void Page(int page, string? search = null)
    {
        if (page is < 1 or > 10000 || search?.Length > 100) throw Invalid("Érvénytelen oldalszám vagy túl hosszú keresés.");
    }
    internal static VehicleSpecification Specification(VehicleSpecification? x)
    {
        if (x is null) throw Invalid("Add meg a jármű adatait.");
        var country = x.RegistrationCountry?.Trim().ToUpperInvariant() ?? "";
        if (!CountryCode().IsMatch(country)) throw Invalid("Kétbetűs országkódot adj meg.");
        var vin = Text(x.Vin, 17, "Alvázszám")?.ToUpperInvariant();
        if (vin is not null && !VinCode().IsMatch(vin)) throw Invalid("Az alvázszám 17 betű vagy szám lehet; I, O és Q nem szerepelhet benne.");
        if (x.Year is < 1900 || x.Year > DateTime.UtcNow.Year + 1) throw Invalid("Érvénytelen gyártási év.");
        foreach (var date in new[] { x.FirstRegistration, x.FleetEntryDate, x.FleetExitDate, x.InspectionDueDate, x.InsuranceDueDate, x.NextServiceDate }) Date(date);
        if (x.FirstRegistration > DateOnly.FromDateTime(DateTime.UtcNow)) throw Invalid("Az első forgalomba helyezés nem lehet jövőbeli.");
        if (x.FleetExitDate is not null && (x.FleetEntryDate is null || x.FleetExitDate < x.FleetEntryDate)) throw Invalid("A flottából kilépéshez korábbi vagy azonos belépési dátum szükséges.");
        Range(x.PowerKw, 10000, "Teljesítmény", 3); Range(x.EngineCapacityCc, 100000, "Hengerűrtartalom");
        Range(x.Seats, 500, "Ülések száma"); Range(x.GrossWeightKg, 200000, "Össztömeg"); Range(x.PayloadKg, 200000, "Teherbírás");
        if (x.PayloadKg > x.GrossWeightKg) throw Invalid("A teherbírás nem lehet nagyobb a megengedett össztömegnél.");
        Range(x.CargoVolumeM3, 1000, "Raktér", 3); Range(x.BatteryKwh, 10000, "Akkumulátor", 3); Range(x.NextServiceKm, 100_000_000, "Következő szerviz km");
        return x with { RegistrationCountry = country, Vin = vin, FleetNumber = Text(x.FleetNumber, 40, "Flottaazonosító")?.ToUpperInvariant(),
            Color = Text(x.Color, 40, "Szín"), Notes = Text(x.Notes, 4000, "Megjegyzés"),
            Category = Choice(x.Category, "Kategória", "Unknown", "PassengerCar", "Van", "Truck", "Bus", "Motorcycle", "Trailer", "Other"),
            FuelType = Choice(x.FuelType, "Üzemanyag", "Unknown", "Petrol", "Diesel", "Hybrid", "PluginHybrid", "Electric", "Lpg", "Cng", "Hydrogen", "Other"),
            Transmission = Choice(x.Transmission, "Váltó", "Unknown", "Manual", "Automatic", "Other"),
            Ownership = Choice(x.Ownership, "Tulajdonlás", "Unknown", "Owned", "Leased", "Rented") };
    }
    internal static PartnerInput Partner(PartnerInput x)
    {
        if (!x.IsLessor && !x.IsService) throw Invalid("Válassz legalább egy partnerkategóriát.");
        if (x.Contacts is null || x.Contacts.Length > 20 || x.Contacts.Any(c => c is null)) throw Invalid("Legfeljebb 20 kapcsolattartó adható meg.");
        return x with { Name = Text(x.Name, 200, "Partner neve", true)!, Address = OrganizationValidation.Address(x.Address),
            Email = OrganizationValidation.Email(x.Email), Phone = Text(x.Phone, 40, "Telefon"), Website = Url(x.Website), Notes = Text(x.Notes, 4000, "Megjegyzés"),
            Contacts = x.Contacts.Select(c => c with { Name = Text(c.Name, 120, "Kapcsolattartó neve", true)!, Position = Text(c.Position, 80, "Beosztás"),
                Email = OrganizationValidation.Email(c.Email), Phone = Text(c.Phone, 40, "Telefon") }).ToArray() };
    }
    internal static LeaseInput Lease(LeaseInput x)
    {
        Date(x.StartDate); Date(x.EndDate);
        if (x.StartDate > x.EndDate) throw Invalid("A szerződés vége nem előzheti meg a kezdetét.");
        Range(x.PaymentAmount, 1_000_000_000_000, "Lízingdíj", 2); Range(x.AnnualKmLimit, 100_000_000, "Éves km-keret"); Range(x.TotalKmLimit, 100_000_000, "Teljes km-keret");
        return x with { ContractNumber = Text(x.ContractNumber, 100, "Szerződésszám", true)!, Currency = Currency(x.Currency),
            BillingFrequency = Choice(x.BillingFrequency, "Fizetési gyakoriság", "Monthly", "Quarterly", "Annual", "Upfront"),
            Status = Choice(x.Status, "Szerződés állapota", "Active", "Closed", "Cancelled"), DocumentUrl = Url(x.DocumentUrl), Notes = Text(x.Notes, 4000, "Megjegyzés") };
    }
    internal static ServiceInput Service(ServiceInput x)
    {
        Date(x.PerformedOn); Date(x.NextServiceDate);
        if (x.PerformedOn > DateOnly.FromDateTime(DateTime.UtcNow)) throw Invalid("Szervizbejegyzés csak elvégzett munkáról rögzíthető.");
        if (x.NextServiceDate < x.PerformedOn || x.NextServiceKm < x.Kilometers) throw Invalid("A következő szerviz nem előzheti meg ezt a szervizelést.");
        Range(x.Kilometers, 100_000_000, "Kilométerállás"); Range(x.NextServiceKm, 100_000_000, "Következő szerviz km"); Range(x.Cost, 1_000_000_000_000, "Költség", 2);
        return x with { Description = Text(x.Description, 2000, "Elvégzett munka", true)!, WorkOrderNumber = Text(x.WorkOrderNumber, 100, "Munkalapszám"),
            Currency = Currency(x.Currency), DocumentUrl = Url(x.DocumentUrl), Notes = Text(x.Notes, 4000, "Megjegyzés") };
    }
    [GeneratedRegex("^[A-Z]{2}$")] private static partial Regex CountryCode();
    [GeneratedRegex("^[A-Z]{3}$")] private static partial Regex CurrencyCode();
    [GeneratedRegex("^[A-HJ-NPR-Z0-9]{17}$")] private static partial Regex VinCode();
}
