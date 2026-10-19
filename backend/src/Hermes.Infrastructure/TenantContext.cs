using Hermes.Application;
using Hermes.Domain;

namespace Hermes.Infrastructure;

public sealed class TenantContext : ITenantContext
{
    public Guid? TenantId { get; private set; }
    public FleetRole? Role { get; private set; }

    public void Set(Guid tenantId, FleetRole role)
    {
        if (TenantId is not null)
            throw new InvalidOperationException("A request's tenant cannot change after resolution.");
        TenantId = tenantId;
        Role = role;
    }
}
