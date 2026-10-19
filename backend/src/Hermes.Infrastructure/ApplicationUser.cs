using Microsoft.AspNetCore.Identity;

namespace Hermes.Infrastructure;

public sealed class ApplicationUser : IdentityUser
{
    public required string DisplayName { get; set; }
}
