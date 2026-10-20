using System.Text.RegularExpressions;

namespace Hermes.Domain;

public static class UserNames
{
    public const string Pattern = "^[a-z0-9][a-z0-9._-]{2,63}$";
    public const string KeyConstraint = "\"Id\" ~ '^[a-z0-9][a-z0-9._-]{2,63}$' AND \"UserName\" IS NOT NULL AND \"UserName\" = \"Id\" AND \"NormalizedUserName\" IS NOT NULL AND \"NormalizedUserName\" = upper(\"Id\")";
    public static string Normalize(string value) => value.Trim().ToLowerInvariant();
    public static bool IsValid(string? value) => !string.IsNullOrWhiteSpace(value)
        && Regex.IsMatch(Normalize(value), Pattern, RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
}

// Historical IDs are retained for audit attribution and reserved against future reuse.
// UserId is null for historical subjects that never had an Identity account.
public sealed class UserIdentityHistory
{
    public required string PreviousId { get; init; }
    public string? UserId { get; init; }
    public string ReservedName { get; private set; } = "";
}
