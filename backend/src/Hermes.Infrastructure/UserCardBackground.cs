namespace Hermes.Infrastructure;

public sealed class UserCardBackground
{
    public required string UserId { get; init; }
    public required byte[] Bytes { get; set; }
    public required string Sha256 { get; set; }
}
