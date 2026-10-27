using Microsoft.AspNetCore.Identity;

namespace Hermes.Infrastructure;

public sealed class ApplicationUser : IdentityUser
{
    public required string DisplayName { get; set; }
    // Existing accounts remain usable when confirmation is enabled for new registrations.
    public bool EmailConfirmationRequired { get; set; }
    public DateTimeOffset? AccountEmailSentAt { get; set; }
    public long ProfileVersion { get; set; } = 1;
    public bool PasswordChangeRequired { get; set; }
    public DateTimeOffset? PasswordChangeRequestedAt { get; set; }
    public DateTimeOffset? PasswordChangedAt { get; set; }
}
