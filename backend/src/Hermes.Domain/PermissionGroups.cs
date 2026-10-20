namespace Hermes.Domain;

// One group model for any number of companies. Membership effects are tenant-owned and protected by RLS.
public sealed class PermissionGroup
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string CreatedBy { get; init; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public bool IsAdmin { get; init; }
    public bool AllPermissions { get; set; }
    public long Version { get; set; } = 1;
    public List<GroupPermission> Permissions { get; set; } = [];
    public List<GroupCompany> Companies { get; set; } = [];
    public string[] EffectivePermissions => AllPermissions ? Hermes.Domain.Permissions.All : Permissions.Select(x => x.Code).ToArray();
}
public sealed class GroupPermission
{
    public Guid GroupId { get; init; }
    public required string Code { get; init; }
}
public sealed class GroupCompany
{
    public Guid GroupId { get; init; }
    public Guid TenantId { get; init; }
    public bool RestrictSites { get; set; }
    public List<GroupCompanySite> Sites { get; set; } = [];
}
public sealed class GroupCompanySite
{
    public Guid GroupId { get; init; }
    public Guid TenantId { get; init; }
    public Guid SiteId { get; init; }
}
public sealed class GroupUser
{
    public Guid GroupId { get; init; }
    public required string UserId { get; init; }
}
// The explicit company selection of an assignment. In particular, the shared admin
// definition must never imply a cross product of every admin user and every company.
public sealed class GroupUserCompany
{
    public Guid GroupId { get; init; }
    public required string UserId { get; init; }
    public Guid TenantId { get; init; }
}
public sealed class MembershipGroup : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public Guid GroupId { get; init; }
    public PermissionGroup Group { get; set; } = null!;
}
