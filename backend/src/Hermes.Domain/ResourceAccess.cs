namespace Hermes.Domain;

public sealed record PermissionSiteScope(string Code, bool AllSites, Guid[] SiteIds);

// Scopes belong to each permission's source. Never combine one group's rights with another group's sites.
public sealed class ResourceAccess(TenantMembership member)
{
    public static bool IsScoped(string code) => code.StartsWith("vehicles.", StringComparison.Ordinal)
        || code.StartsWith("sites.", StringComparison.Ordinal) || code == Permissions.AuditRead;
    private IEnumerable<GroupCompany> Sources(string code) => member.Groups
        .Where(x => x.Group.EffectivePermissions.Contains(code))
        .SelectMany(x => x.Group.Companies.Where(c => c.TenantId == member.TenantId));
    public bool CompanyWide(string code) => member.Permissions.Any(x => x.Code == code)
        || (!IsScoped(code) ? member.EffectivePermissions.Contains(code) : Sources(code).Any(x => !x.RestrictSites));
    public Guid[] Sites(string code) => Sources(code).SelectMany(x => x.Sites.Select(s => s.SiteId)).Distinct().Order().ToArray();
    public bool Allows(string code, Guid? site) => CompanyWide(code) || site is { } id && Sites(code).Contains(id);
    public bool Covers(string code, bool allSites, IEnumerable<Guid> sites) => CompanyWide(code)
        || !allSites && IsScoped(code) && !sites.Except(Sites(code)).Any() && member.EffectivePermissions.Contains(code);
    public bool Covers(TenantMembership target)
    {
        var other = new ResourceAccess(target);
        return target.EffectivePermissions.All(code => Covers(code, other.CompanyWide(code), other.Sites(code)));
    }
    public PermissionSiteScope[] Describe() => member.EffectivePermissions.Where(IsScoped)
        .Select(code => new PermissionSiteScope(code, CompanyWide(code), Sites(code))).ToArray();
}
