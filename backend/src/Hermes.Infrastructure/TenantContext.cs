using Hermes.Application;
using Hermes.Domain;

namespace Hermes.Infrastructure;

public sealed class TenantContext : ITenantContext
{
    public Guid? TenantId { get; private set; }
    public string? UserSubject { get; private set; }
    public IReadOnlySet<string> Permissions { get; private set; } = new HashSet<string>(StringComparer.Ordinal);

    public void Set(Guid tenantId, string userSubject, IEnumerable<string> permissions)
    {
        if (TenantId is not null)
            throw new InvalidOperationException("A request's tenant cannot change after resolution.");
        TenantId = tenantId;
        UserSubject = userSubject;
        Permissions = permissions.ToHashSet(StringComparer.Ordinal);
    }
}
