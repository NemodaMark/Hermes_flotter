using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using Hermes.Application;

namespace Hermes.Infrastructure;

internal static partial class OrganizationValidation
{
    private static ManagementException Invalid(string message) => UserAccounts.Error(400, "invalid_company_data", message);
    internal static string? Text(string? value, int max, string label, bool required = false)
    {
        var text = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (required && text is null || text?.Length > max) throw Invalid($"{label}: {(required ? "kötelező mező, " : "")}legfeljebb {max} karakter.");
        return text;
    }
    internal static string? Email(string? value)
    {
        var email = Text(value, 254, "E-mail-cím");
        if (email is not null && !new EmailAddressAttribute().IsValid(email)) throw Invalid("Érvénytelen e-mail-cím.");
        return email;
    }
    internal static AddressInput Address(AddressInput? input)
    {
        if (input is null || !Country().IsMatch(input.CountryCode?.Trim() ?? "")) throw Invalid("Az országot kétbetűs kóddal add meg.");
        return new(input.CountryCode!.Trim().ToUpperInvariant(), Text(input.PostalCode, 20, "Irányítószám"), Text(input.City, 120, "Település"),
            Text(input.AddressLine1, 200, "Utca, házszám"), Text(input.AddressLine2, 200, "Címkiegészítés"));
    }
    internal static CompanyInput Company(CompanyInput x)
    {
        var zone = Text(x.TimeZone, 80, "Időzóna", true)!;
        try { TimeZoneInfo.FindSystemTimeZoneById(zone); }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { throw Invalid("Ismeretlen időzóna."); }
        var currency = x.Currency?.Trim().ToUpperInvariant() ?? "";
        if (!Currency().IsMatch(currency)) throw Invalid("A pénznemet hárombetűs kóddal add meg.");
        if (x.DistanceUnit is not ("km" or "mi")) throw Invalid("A távolságegység km vagy mi lehet.");
        var website = Text(x.Website, 2048, "Weboldal");
        if (website is not null && (!Uri.TryCreate(website, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)))
            throw Invalid("A weboldal teljes http:// vagy https:// cím legyen.");
        return x with { Name = Text(x.Name, 160, "Cégnév", true)!, LegalName = Text(x.LegalName, 200, "Hivatalos cégnév"),
            TaxNumber = Text(x.TaxNumber, 40, "Adószám"), RegistrationNumber = Text(x.RegistrationNumber, 40, "Cégjegyzékszám"),
            EuVatNumber = Text(x.EuVatNumber, 40, "Közösségi adószám"), Address = Address(x.Address),
            Email = Email(x.Email), Phone = Text(x.Phone, 40, "Telefonszám"), Website = website, TimeZone = zone, Currency = currency };
    }
    internal static ContactInput Contact(ContactInput x) => x with { Name = Text(x.Name, 120, "Név", true)!, Position = Text(x.Position, 80, "Beosztás"), Email = Email(x.Email), Phone = Text(x.Phone, 40, "Telefonszám") };
    internal static SiteInput Site(SiteInput x)
    {
        var code = Text(x.Code, 32, "Telephelykód", true)!;
        if (!SiteCode().IsMatch(code)) throw Invalid("A telephelykód betűt, számot, kötőjelet és aláhúzást tartalmazhat.");
        return x with { Name = Text(x.Name, 120, "Telephely neve", true)!, Code = code, Address = Address(x.Address), Email = Email(x.Email), Phone = Text(x.Phone, 40, "Telefonszám") };
    }
    internal static string Reason(string? value) => Text(value, 500, "Az állapotváltozás indoka", true)!;
    internal static void Revision(long actual, long requested)
    {
        if (requested < 1) throw UserAccounts.Error(400, "invalid_version", "Add meg az aktuális adatverziót.");
        if (actual != requested) throw UserAccounts.Error(409, "stale_organization", "Az adat időközben megváltozott. Töltsd be újra a friss változatot.");
    }
    [GeneratedRegex("^[A-Za-z]{2}$")] private static partial Regex Country();
    [GeneratedRegex("^[A-Z]{3}$")] private static partial Regex Currency();
    [GeneratedRegex("^[A-Za-z0-9_-]+$")] private static partial Regex SiteCode();
}
