using Microsoft.AspNetCore.Identity;

namespace Hermes.Infrastructure;

public sealed class ApplicationUser : IdentityUser
{
    public required string DisplayName { get; set; }
    public long ProfileVersion { get; set; } = 1;
    public bool PasswordChangeRequired { get; set; }
    public DateTimeOffset? PasswordChangeRequestedAt { get; set; }
    public DateTimeOffset? PasswordChangedAt { get; set; }
}
