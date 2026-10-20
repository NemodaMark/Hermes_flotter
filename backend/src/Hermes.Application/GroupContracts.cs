namespace Hermes.Application;

public sealed record AssignedGroup(Guid Id, string Name, bool IsAdmin)
{
    public bool IsMultiCompany { get; init; }
}
public sealed record PermissionGroupSummary(Guid Id, string Name, bool IsAdmin, long Version, string[] Permissions, int MemberCount);
public sealed record CreateGroupRequest(string Name, string[] Permissions);
public sealed record UpdateGroupRequest(string Name, string[] Permissions, long Version);
public sealed record ChangeGroupsRequest(Guid[] GroupIds, long Version);

public interface IGroupManagement
{
    Task<PermissionGroupSummary[]> ListAsync(CancellationToken ct);
    Task<PermissionGroupSummary> CreateAsync(CreateGroupRequest request, CancellationToken ct);
    Task<PermissionGroupSummary> UpdateAsync(Guid id, UpdateGroupRequest request, CancellationToken ct);
    Task DeleteAsync(Guid id, long version, CancellationToken ct);
    Task<TenantAccess> AssignAsync(string userId, ChangeGroupsRequest request, CancellationToken ct);
}
