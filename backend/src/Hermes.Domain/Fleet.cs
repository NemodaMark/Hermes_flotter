namespace Hermes.Domain;

public enum VehicleStatus { Active, Maintenance, Inactive, Archived }

public sealed class Tenant
{
    public Guid Id { get; init; }
    public required string Name { get; set; }
    public string TimeZone { get; set; } = "Europe/Budapest";
}

public sealed class TenantMembership : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public bool IsActive { get; set; } = true;
    public bool HasDirectAccess { get; set; } = true;
    public long Version { get; set; } = 1;
    public DateTimeOffset? JoinedAt { get; init; }
    public DateTimeOffset? DisabledAt { get; set; }
    public List<MembershipPermission> Permissions { get; set; } = [];
    public List<MembershipGroup> Groups { get; set; } = [];
    public bool HasCompanyAccess => IsActive && (HasDirectAccess || Groups.Count > 0);
    public bool HasAdminAuthority => Groups.Any(x => x.Group.AllPermissions
        && x.Group.Companies.Any(c => c.TenantId == TenantId && !c.RestrictSites));
    public string[] EffectivePermissions => Permissions.Select(x => x.Code)
        .Concat(Groups.SelectMany(x => x.Group.EffectivePermissions))
        .Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
}

public sealed class Vehicle : ITenantEntity
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid TenantId { get; init; }
    public required string Registration { get; set; }
    public required string Make { get; set; }
    public required string Model { get; set; }
    public long Version { get; set; } = 1;
    public long? OdometerKm { get; set; }
    public VehicleStatus Status { get; set; } = VehicleStatus.Active;
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
}

public sealed class OdometerReading : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public Guid VehicleId { get; init; }
    public long Kilometers { get; init; }
    public required string RecordedBy { get; init; }
    public DateTimeOffset RecordedAt { get; init; } = DateTimeOffset.UtcNow;
}
