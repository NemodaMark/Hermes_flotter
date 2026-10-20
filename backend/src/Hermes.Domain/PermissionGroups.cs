namespace Hermes.Domain;

public sealed class PermissionGroup : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public bool IsAdmin { get; init; }
    public long Version { get; set; } = 1;
    public List<GroupPermission> Permissions { get; set; } = [];
    public string[] EffectivePermissions => IsAdmin ? Hermes.Domain.Permissions.All : Permissions.Select(x => x.Code).ToArray();
}

public sealed class GroupPermission : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid GroupId { get; init; }
    public required string Code { get; init; }
}

public sealed class MembershipGroup : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public Guid GroupId { get; init; }
    public PermissionGroup Group { get; set; } = null!;
}
