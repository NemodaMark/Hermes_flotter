namespace Hermes.Domain;

public sealed record PermissionDescription(string Code, string Name);

public static class Permissions
{
    public const string VehiclesRead = "vehicles.read";
    public const string VehiclesCreate = "vehicles.create";
    public const string VehiclesUpdate = "vehicles.update";
    public const string OdometerCreate = "vehicles.odometer.create";
    public const string GroupsManage = "permission-groups.manage";
    public const string MembersRead = "members.read";
    public const string MembersInvite = "members.invite";
    public const string MembersUpdate = "members.update";
    public const string Manage = "permissions.manage";
    public const string AuditRead = "audit.read";
    public static readonly IReadOnlyList<PermissionDescription> Catalog = Array.AsReadOnly(new[]
    {
        new PermissionDescription(VehiclesRead, "Járművek megtekintése"), new(VehiclesCreate, "Jármű felvétele"),
        new(VehiclesUpdate, "Járműadatok szerkesztése"), new(OdometerCreate, "Kilométerállás rögzítése"),
        new(GroupsManage, "Jogosultságcsoportok kezelése"),
        new(MembersRead, "Céges felhasználók megtekintése"), new(MembersInvite, "Meghívások kezelése"),
        new(MembersUpdate, "Céges hozzáférések felfüggesztése és visszaállítása"),
        new(Manage, "Céges jogosultságok kiosztása"), new(AuditRead, "Jogosultsági eseménynapló megtekintése")
    });
    public static string[] All => Catalog.Select(item => item.Code).ToArray();
}

public interface ITenantEntity { Guid TenantId { get; } }
public sealed class PermissionDefinition
{
    public required string Code { get; init; }
    public required string Name { get; init; }
}
public sealed class MembershipPermission : ITenantEntity
{
    public Guid TenantId { get; init; }
    public required string UserSubject { get; init; }
    public required string Code { get; init; }
}
public sealed class TenantInvitation : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string Email { get; init; }
    public required string NormalizedEmail { get; init; }
    public required string TokenHash { get; init; }
    public required string InvitedBy { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; init; }
    public DateTimeOffset? AcceptedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public List<InvitationPermission> Permissions { get; set; } = [];
}
public sealed class InvitationPermission : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid InvitationId { get; init; }
    public required string Code { get; init; }
}
public sealed class AccessAuditEvent : ITenantEntity
{
    public Guid TenantId { get; init; }
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public required string ActorSubject { get; init; }
    public required string Action { get; init; }
    public string? TargetSubject { get; init; }
    public required string Details { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
