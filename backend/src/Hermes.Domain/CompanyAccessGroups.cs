namespace Hermes.Domain;

// Cross-company definitions are global. Their per-company effects are tenant-owned and protected by RLS.
public sealed class CompanyAccessGroup
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string CreatedBy { get; init; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public bool AllPermissions { get; set; }
    public long Version { get; set; } = 1;
    public List<CompanyAccessPermission> Permissions { get; set; } = [];
    public List<CompanyAccessScope> Companies { get; set; } = [];
    public string[] EffectivePermissions => AllPermissions ? Hermes.Domain.Permissions.All : Permissions.Select(x => x.Code).ToArray();
}
public sealed class CompanyAccessPermission
{
    public Guid GroupId { get; init; }
    public required string Code { get; init; }
}
public sealed class CompanyAccessScope
{
    public Guid GroupId { get; init; }
    public Guid TenantId { get; init; }
}
public sealed class CompanyAccessUser
{
    public Guid GroupId { get; init; }
    public required string UserId { get; init; }
}
public sealed class CompanyAccessMembership : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public Guid GroupId { get; init; }
    public CompanyAccessGroup Group { get; set; } = null!;
}
