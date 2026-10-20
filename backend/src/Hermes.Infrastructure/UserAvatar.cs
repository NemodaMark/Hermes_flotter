namespace Hermes.Infrastructure;

public sealed class UserAvatar
{
    public required string UserId { get; init; }
    public required byte[] Bytes { get; set; }
    public required string Sha256 { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
