namespace Hermes.Application;

public sealed record CompanyAccessOption(Guid Id, string Name, string[] Permissions, bool CanEdit, bool CanAssign, bool CanGrantAll);
public sealed record CompanyAccessTarget(Guid Id, string Name);
public sealed record CompanyAccessGroupSummary(Guid Id, string Name, string CreatedBy, long Version, bool AllPermissions,
    string[] Permissions, CompanyAccessTarget[] Companies, int MemberCount, bool CanEdit, bool CanAssign);
public sealed record CreateCompanyAccessGroupRequest(string Name, string[] Permissions, Guid[] CompanyIds, bool AllPermissions = false);
public sealed record UpdateCompanyAccessGroupRequest(string Name, string[] Permissions, Guid[] CompanyIds, long Version, bool AllPermissions = false);
public sealed record CompanyAccessUserSummary(string UserId, long Version, Guid[] GroupIds, bool HasOtherGroups);
public sealed record AssignCompanyAccessGroupsRequest(Guid[] GroupIds, long Version);

public interface ICompanyAccessGroups
{
    Task<CompanyAccessOption[]> CompaniesAsync(string actor, CancellationToken ct);
    Task<CompanyAccessGroupSummary[]> ListAsync(string actor, CancellationToken ct);
    Task<CompanyAccessGroupSummary> CreateAsync(string actor, CreateCompanyAccessGroupRequest request, CancellationToken ct);
    Task<CompanyAccessGroupSummary> UpdateAsync(string actor, Guid id, UpdateCompanyAccessGroupRequest request, CancellationToken ct);
    Task DeleteAsync(string actor, Guid id, long version, CancellationToken ct);
    Task<CompanyAccessUserSummary> UserAsync(string actor, string userId, CancellationToken ct);
    Task<CompanyAccessUserSummary> AssignAsync(string actor, string userId, AssignCompanyAccessGroupsRequest request, CancellationToken ct);
}
