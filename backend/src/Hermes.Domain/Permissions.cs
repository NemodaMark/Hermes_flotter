namespace Hermes.Domain;

public sealed record PermissionDescription(string Code, string Name);

public static class Permissions
{
    public const string VehiclesRead = "vehicles.read";
    public const string FleetOverviewRead = "vehicles.overview.read";
    public const string VehiclesCreate = "vehicles.create";
    public const string VehiclesUpdate = "vehicles.update";
    public const string VehiclesAssignUsers = "vehicles.users.assign";
    public const string OdometerCreate = "vehicles.odometer.create";
    public const string VehiclesArchive = "vehicles.archive";
    public const string LeasingRead = "vehicles.leasing.read";
    public const string LeasingManage = "vehicles.leasing.manage";
    public const string ServicesRead = "vehicles.service.read";
    public const string ServicesManage = "vehicles.service.manage";
    public const string DocumentsRead = "vehicles.documents.read";
    public const string DocumentsManage = "vehicles.documents.manage";
    public const string BookingsRead = "vehicles.bookings.read";
    public const string BookingsCreate = "vehicles.bookings.create";
    public const string BookingsManage = "vehicles.bookings.manage";
    public const string FuelRead = "vehicles.fuel.read";
    public const string FuelManage = "vehicles.fuel.manage";
    public const string MileageRecord = "mileage.record";
    public const string MileageManage = "mileage.manage";
    public const string PartnersRead = "partners.read";
    public const string PartnersCreate = "partners.create";
    public const string PartnersUpdate = "partners.update";
    public const string PartnersArchive = "partners.archive";
    public const string GroupsManage = "permission-groups.manage";
    public const string MembersRead = "members.read";
    public const string MembersInvite = "members.invite";
    public const string MembersUpdate = "members.update";
    public const string Manage = "permissions.manage";
    public const string AuditRead = "audit.read";
    public const string CompaniesRead = "companies.read";
    public const string CompaniesUpdate = "companies.update";
    public const string CompaniesStatus = "companies.status";
    public const string SitesRead = "sites.read";
    public const string SitesCreate = "sites.create";
    public const string SitesUpdate = "sites.update";
    public const string SitesArchive = "sites.archive";
    public const string SitesAssignVehicles = "sites.vehicles.assign";
    public static readonly IReadOnlyList<PermissionDescription> Catalog = Array.AsReadOnly(new[]
    {
        new PermissionDescription(MileageRecord, "Saját havi km-elszámolás és magánhasználat rögzítése"),
        new PermissionDescription(MileageManage, "Céges km-keretek és havi elszámolások kezelése"),
        new PermissionDescription(VehiclesRead, "Járművek megtekintése"), new(FleetOverviewRead, "Flottaáttekintő megtekintése"), new(VehiclesCreate, "Jármű felvétele"),
        new(VehiclesUpdate, "Járműadatok szerkesztése"), new(OdometerCreate, "Kilométerállás rögzítése"),
        new(VehiclesAssignUsers, "Jármű felhasználóhoz rendelése"),
        new(VehiclesArchive, "Jármű archiválása és visszaállítása"),
        new(LeasingRead, "Jármű lízingszerződéseinek megtekintése"), new(LeasingManage, "Jármű lízingszerződéseinek kezelése"),
        new(ServicesRead, "Jármű szervizelőzményeinek megtekintése"), new(ServicesManage, "Jármű szervizbejegyzéseinek kezelése"),
        new(DocumentsRead, "Járműokmányok megtekintése"), new(DocumentsManage, "Járműokmányok kezelése"),
        new(BookingsRead, "Járműfoglalások megtekintése"), new(BookingsCreate, "Jármű foglalása és saját foglalás lemondása"),
        new(BookingsManage, "Járműfoglalási beállítás és foglalások kezelése"),
        new(FuelRead, "Tankolások és elszámolások megtekintése"), new(FuelManage, "Tankolások rögzítése és érvénytelenítése"),
        new(PartnersRead, "Partnerek és kapcsolattartók megtekintése"), new(PartnersCreate, "Partner felvétele"),
        new(PartnersUpdate, "Partneradatok szerkesztése"), new(PartnersArchive, "Partner archiválása és visszaállítása"),
        new(GroupsManage, "Jogosultságcsoportok kezelése"),
        new(MembersRead, "Céges felhasználók megtekintése"), new(MembersInvite, "Meghívások kezelése"),
        new(MembersUpdate, "Céges hozzáférések felfüggesztése és visszaállítása"),
        new(Manage, "Céges jogosultságok kiosztása"), new(AuditRead, "Változásnapló megtekintése"),
        new(CompaniesRead, "Cégadatok és kapcsolattartók megtekintése"),
        new(CompaniesUpdate, "Cégadatok és kapcsolattartók szerkesztése"),
        new(CompaniesStatus, "Cég felfüggesztése, archiválása és visszaállítása"),
        new(SitesRead, "Telephelyek megtekintése"), new(SitesCreate, "Telephely létrehozása"),
        new(SitesUpdate, "Telephelyadatok szerkesztése"), new(SitesArchive, "Telephely archiválása és visszaállítása"),
        new(SitesAssignVehicles, "Jármű telephelyhez rendelése")
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
