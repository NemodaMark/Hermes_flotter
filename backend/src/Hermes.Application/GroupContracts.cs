namespace Hermes.Application;

public sealed record GroupCompanyOption(Guid Id, string Name, string[] Permissions, bool CanEdit, bool CanAssign, bool CanGrantAll);
public sealed record GroupCompanyTarget(Guid Id, string Name);
public sealed record PermissionGroupSummary(Guid Id, string Name, string CreatedBy, long Version, bool AllPermissions, bool IsAdmin,
    string[] Permissions, GroupCompanyTarget[] Companies, int MemberCount, bool CanEdit, bool CanAssign);
public sealed record CreateGroupRequest(string Name, string[] Permissions, Guid[] CompanyIds, bool AllPermissions = false);
public sealed record UpdateGroupRequest(string Name, string[] Permissions, Guid[] CompanyIds, long Version, bool AllPermissions = false);
public sealed record GroupUserSummary(string UserId, long Version, Guid[] GroupIds, bool HasOtherGroups);
public sealed record AssignGroupsRequest(Guid[] GroupIds, long Version);

public interface IGroupManagement
{
    Task<GroupCompanyOption[]> CompaniesAsync(string actor, CancellationToken ct);
    Task<PermissionGroupSummary[]> ListAsync(string actor, CancellationToken ct);
    Task<PermissionGroupSummary> CreateAsync(string actor, CreateGroupRequest request, CancellationToken ct);
    Task<PermissionGroupSummary> UpdateAsync(string actor, Guid id, UpdateGroupRequest request, CancellationToken ct);
    Task DeleteAsync(string actor, Guid id, long version, CancellationToken ct);
    Task<GroupUserSummary> UserAsync(string actor, string userId, CancellationToken ct);
    Task<GroupUserSummary> AssignAsync(string actor, string userId, AssignGroupsRequest request, CancellationToken ct);
}

public sealed record AssignedGroup(Guid Id, string Name, bool IsAdmin);
