using System.Text;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.EntityFrameworkCore;
using static Hermes.Infrastructure.CsvImport;

namespace Hermes.Infrastructure;

internal sealed partial class CsvImportCompany(HermesDbContext db, CsvImportPackage package, ImportCompany input,
    ImportUsers users, Dictionary<string, ImportedGroup> groups, Guid adminId, string? owner, bool hasSystemManager)
{
    private Guid TenantId => input.Company.Id;
    private readonly Dictionary<string, CompanyContact> contacts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Site> sites = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TenantMembership> memberships = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Partner> partners = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ImportedVehicle> vehicles = new(StringComparer.Ordinal);
    private readonly Dictionary<string, VehicleLease> leases = new(StringComparer.Ordinal);
    private readonly Dictionary<string, VehicleService> services = new(StringComparer.Ordinal);
    private readonly HashSet<string> usable = new(StringComparer.Ordinal);

    public async Task RunAsync(CancellationToken ct)
    {
        ImportOrganization();
        await ImportAccess(ct);
        ImportPartners();
        ImportVehicles();
        PrepareFiles();
        ImportHistory();
        ImportAudit();
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
        await ImportAttachments(ct);
        foreach (var table in package.Counts.Keys.Where(CsvImportPackage.IsCompanyScoped))
        foreach (var row in Rows(table))
            if (ReadRow(row, () => Provenance(row, users)) is { } provenance)
                Audit("data.csv_provenance", null, Actor, DateTimeOffset.UtcNow, provenance);
        await db.SaveChangesAsync(ct);
    }

    private IEnumerable<CsvImportRow> Rows(string name) =>
        package.Rows(name).Where(row => row.Text("company_ref") == input.Reference);

    private void Each(string table, Action<CsvImportRow> action)
    {
        foreach (var row in Rows(table)) ReadRow(row, () => { action(row); return true; });
    }

    private static void Add<T>(Dictionary<string, T> dictionary, CsvImportRow row, string key, T value)
    {
        if (!dictionary.TryAdd(row.Require(key), value)) throw row.Error($"Ismétlődő {key}.");
    }

    private static T Find<T>(Dictionary<string, T> dictionary, CsvImportRow row, string key)
        => dictionary.TryGetValue(row.Require(key), out var value) ? value : throw row.Error($"Ismeretlen {key} ebben a cégben.");

    private string CreatedBy(CsvImportRow row) => users.Actor(row, "source_created_by");
    private string? UpdatedBy(CsvImportRow row) => users.OptionalActor(row, "source_updated_by");

    private void ImportOrganization()
    {
        ReadRow(input.Row, () =>
        {
            var row = input.Row;
            var data = input.Data;
            var status = FleetValidation.Choice(row.Text("status") ?? "Active", "Cégállapot", "Active", "Suspended", "Archived");
            var statusReason = row.Field("status_reason", 500);
            var statusAt = row.Time("status_changed_at");
            db.CompanyProfiles.Add(new()
            {
                TenantId = TenantId, LegalName = data.LegalName, TaxNumber = data.TaxNumber, RegistrationNumber = data.RegistrationNumber,
                EuVatNumber = data.EuVatNumber, CountryCode = data.Address.CountryCode, PostalCode = data.Address.PostalCode, City = data.Address.City,
                AddressLine1 = data.Address.AddressLine1, AddressLine2 = data.Address.AddressLine2, Email = data.Email, Phone = data.Phone,
                Website = data.Website, Currency = data.Currency, DistanceUnit = data.DistanceUnit, CreatedAt = row.Time("source_created_at"),
                CreatedBy = users.OptionalActor(row, "source_created_by"), UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row),
                StatusChangedAt = statusAt, StatusReason = statusReason
            });
            if (status != "Active") db.ArchivedTenants.Add(new()
            {
                TenantId = TenantId, Status = status, Reason = statusReason ?? "A forrásban szereplő cégállapot.",
                ArchivedAt = statusAt ?? DateTimeOffset.UtcNow
            });
            return true;
        });
        Each("company_contacts", row =>
        {
            var data = OrganizationValidation.Contact(new(row.Require("name"), row.Text("position"), row.Text("email"), row.Text("phone")));
            var contact = new CompanyContact
            {
                TenantId = TenantId, Name = data.Name, Position = data.Position, Email = data.Email, Phone = data.Phone,
                IsArchived = row.Bool("is_archived", false), ArchivedAt = row.Time("archived_at"), StatusReason = row.Field("status_reason", 500),
                CreatedAt = row.Time("source_created_at") ?? DateTimeOffset.UtcNow, CreatedBy = CreatedBy(row),
                UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row)
            };
            Add(contacts, row, "contact_ref", contact);
            db.CompanyContacts.Add(contact);
        });
        var codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Each("sites", row =>
        {
            var contact = row.Text("contact_ref") is null ? null : Find(contacts, row, "contact_ref");
            var archived = row.Bool("is_archived", false);
            if (!archived && contact?.IsArchived == true) throw row.Error("Aktív telephelyhez archivált kapcsolattartó tartozik.");
            var data = OrganizationValidation.Site(new(row.Require("name"), row.Require("code"), Address(row), row.Text("email"), row.Text("phone"), contact?.Id));
            Unique(row, codes, data.Code);
            var site = new Site
            {
                TenantId = TenantId, Name = data.Name, Code = data.Code, NormalizedCode = data.Code.ToUpperInvariant(),
                CountryCode = data.Address.CountryCode, PostalCode = data.Address.PostalCode, City = data.Address.City,
                AddressLine1 = data.Address.AddressLine1, AddressLine2 = data.Address.AddressLine2,
                Email = data.Email, Phone = data.Phone, ContactId = data.ContactId, IsArchived = archived,
                ArchivedAt = row.Time("archived_at"), StatusReason = row.Field("status_reason", 500),
                CreatedAt = row.Time("source_created_at") ?? DateTimeOffset.UtcNow, CreatedBy = CreatedBy(row),
                UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row)
            };
            Add(sites, row, "site_ref", site);
            db.Sites.Add(site);
        });
    }

    private async Task ImportAccess(CancellationToken ct)
    {
        Each("memberships", row =>
        {
            var user = users.Find(row);
            var membership = new TenantMembership
            {
                TenantId = TenantId, UserSubject = user.Name, IsActive = row.Bool("is_active"),
                HasDirectAccess = row.Bool("has_direct_access"), JoinedAt = row.Time("joined_at"), DisabledAt = row.Time("disabled_at")
            };
            if (!memberships.TryAdd(user.Name, membership)) throw row.Error("Ismétlődő cégtagság.");
            if (!user.Archived) usable.Add(user.Name);
            db.Memberships.Add(membership);
        });
        var names = new HashSet<string>(StringComparer.Ordinal);
        var scopes = new Dictionary<Guid, GroupCompany>();
        Each("group_companies", row =>
        {
            var group = FindGroup(groups, row);
            Unique(row, names, group.Group.NormalizedName);
            var scope = new GroupCompany { GroupId = group.Group.Id, TenantId = TenantId, RestrictSites = row.Bool("restrict_sites") };
            scopes.Add(group.Group.Id, scope);
            db.GroupCompanies.Add(scope);
        });
        var scopeSites = new HashSet<(Guid, Guid)>();
        Each("group_sites", row =>
        {
            var group = FindGroup(groups, row);
            var site = Find(sites, row, "site_ref");
            if (!scopes.TryGetValue(group.Group.Id, out var scope) || !scope.RestrictSites)
                throw row.Error("A telephelyhez előbb korlátozott cégkör szükséges a group_companies.csv-ben.");
            Unique(row, scopeSites, (scope.GroupId, site.Id));
            scope.Sites.Add(new() { GroupId = scope.GroupId, TenantId = TenantId, SiteId = site.Id });
        });
        var groupManagers = new HashSet<string>(StringComparer.Ordinal);
        foreach (var group in groups.Values.Where(x => scopes.ContainsKey(x.Group.Id)))
        {
            var scope = scopes[group.Group.Id];
            if (scope.RestrictSites && scope.Sites.Count == 0)
                throw new InvalidDataException("A korlátozott csoporthoz legalább egy telephely szükséges a group_sites.csv-ben.");
            foreach (var user in group.Users)
            {
                AttachGroup(group.Group.Id, user);
                if (group.Group.AllPermissions || group.Permissions.Contains(Permissions.Manage)) groupManagers.Add(user);
            }
        }
        // A group-only user may not have an explicit membership row in the export.
        foreach (var row in package.Rows("group_users"))
        {
            if (!scopes.ContainsKey(FindGroup(groups, row).Group.Id)) continue;
            var user = users.Find(row);
            if (!user.Archived) usable.Add(user.Name);
        }
        var directPermissions = new HashSet<(string, string)>();
        Each("member_permissions", row =>
        {
            var name = users.Find(row).Name;
            var code = Permission(row);
            if (!memberships.ContainsKey(name)) throw row.Error("A közvetlen joghoz cégtagság szükséges.");
            Unique(row, directPermissions, (name, code));
            db.MembershipPermissions.Add(new() { TenantId = TenantId, UserSubject = name, Code = code });
        });
        var admins = new HashSet<string>(StringComparer.Ordinal);
        Each("admin_companies", row =>
        {
            var user = users.Find(row);
            Unique(row, admins, user.Name);
            if (!user.Archived) usable.Add(user.Name);
        });
        if (owner is not null)
        {
            if (memberships.TryGetValue(owner, out var member) && !member.IsActive)
                throw new InvalidDataException("A --owner felhasználó felfüggesztett tagsággal szerepel a csomagban.");
            admins.Add(owner);
            usable.Add(owner);
        }
        if (admins.Count > 0)
        {
            db.GroupCompanies.Add(new() { GroupId = adminId, TenantId = TenantId });
            var existing = await db.GroupUsers.Where(x => x.GroupId == adminId).Select(x => x.UserId).ToListAsync(ct);
            foreach (var user in admins)
            {
                if (!existing.Contains(user)) db.GroupUsers.Add(new() { GroupId = adminId, UserId = user });
                AttachGroup(adminId, user);
                groupManagers.Add(user);
            }
        }
        if (!hasSystemManager && !memberships.Values.Any(member => usable.Contains(member.UserSubject) && member.IsActive
                && (groupManagers.Contains(member.UserSubject) || member.HasDirectAccess && directPermissions.Contains((member.UserSubject, Permissions.Manage)))))
            throw input.Row.Error("A céghez aktív jogosultságkezelő szükséges. Add meg az admin_companies.csv-ben vagy a --owner kapcsolóval.");
    }

    private void AttachGroup(Guid group, string user)
    {
        if (!memberships.ContainsKey(user))
        {
            var member = new TenantMembership { TenantId = TenantId, UserSubject = user, HasDirectAccess = false };
            memberships.Add(user, member);
            db.Memberships.Add(member);
        }
        db.GroupUserCompanies.Add(new() { GroupId = group, UserId = user, TenantId = TenantId });
        db.MembershipGroups.Add(new() { TenantId = TenantId, UserSubject = user, GroupId = group });
    }

    private void ImportPartners()
    {
        var contactList = Rows("partner_contacts").GroupBy(row => row.Require("partner_ref"), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Select(row => new PartnerContactInput(row.Require("name"),
                row.Text("position"), row.Text("email"), row.Text("phone"))).ToArray(), StringComparer.Ordinal);
        Each("partners", row =>
        {
            var reference = row.Require("partner_ref");
            var data = FleetValidation.Partner(new(row.Require("name"), row.Bool("is_lessor"), row.Bool("is_service"),
                Address(row), row.Text("email"), row.Text("phone"), row.Text("website"), row.Text("notes"), contactList.GetValueOrDefault(reference) ?? []));
            var partner = new Partner
            {
                TenantId = TenantId, Name = data.Name, IsLessor = data.IsLessor, IsService = data.IsService, CountryCode = data.Address.CountryCode,
                PostalCode = data.Address.PostalCode, City = data.Address.City, AddressLine1 = data.Address.AddressLine1, AddressLine2 = data.Address.AddressLine2,
                Email = data.Email, Phone = data.Phone, Website = data.Website, Notes = data.Notes,
                SearchText = $"{data.Name} {data.Address.City}".Normalize(NormalizationForm.FormKC).ToUpperInvariant(),
                ContactsJson = JsonSerializer.Serialize(data.Contacts), IsArchived = row.Bool("is_archived", false),
                StatusReason = row.Field("status_reason", 500), CreatedAt = row.Time("source_created_at") ?? DateTimeOffset.UtcNow,
                CreatedBy = CreatedBy(row), UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row)
            };
            Add(partners, row, "partner_ref", partner);
            db.Partners.Add(partner);
        });
        Each("partner_contacts", row => Find(partners, row, "partner_ref"));
    }

    private void ImportVehicles()
    {
        var plates = new HashSet<string>(StringComparer.Ordinal);
        var vins = new HashSet<string>(StringComparer.Ordinal);
        var fleetNumbers = new HashSet<string>(StringComparer.Ordinal);
        var models = new HashSet<(string, string)>();
        Each("vehicles", row =>
        {
            var plate = row.Require("registration");
            var make = row.Require("make");
            var model = row.Require("model");
            if (VehicleValidation.Validate(new(plate, make, model)).Count != 0) throw row.Error("Érvénytelen rendszám, gyártó vagy modell.");
            var km = row.Long("odometer_km");
            FleetValidation.Range(km, 100_000_000, "Kilométerállás");
            var car = new Vehicle
            {
                TenantId = TenantId, Registration = FleetManagement.NormalizeRegistration(plate), Make = make, Model = model,
                Status = Enum.Parse<VehicleStatus>(FleetValidation.Choice(row.Text("status") ?? "Active", "Járműállapot",
                    "Active", "Maintenance", "Inactive", "Archived")),
                CreatedAt = row.Time("source_created_at")?.UtcDateTime ?? DateTime.UtcNow, CreatedBy = CreatedBy(row), OdometerKm = km
            };
            var partner = row.Text("preferred_service_partner_ref") is null ? null : Find(partners, row, "preferred_service_partner_ref");
            if (partner is not null && (partner.IsArchived || !partner.IsService)) throw row.Error("Az alapértelmezett szervizpartner legyen aktív szerviz.");
            var data = FleetValidation.Specification(new()
            {
                RegistrationCountry = row.Text("registration_country") ?? "HU", Vin = row.Text("vin"), FleetNumber = row.Text("fleet_number"),
                Category = row.Text("category") ?? "Unknown", BodyType = row.Text("body_type") ?? "Unknown", Year = row.Int("year"),
                FirstRegistration = row.Date("first_registration"), Color = row.Text("color"), FuelType = row.Text("fuel_type") ?? "Unknown",
                PowerKw = row.Decimal("power_kw"), EngineCapacityCc = row.Int("engine_capacity_cc"), Transmission = row.Text("transmission") ?? "Unknown",
                Seats = row.Int("seats"), GrossWeightKg = row.Int("gross_weight_kg"), PayloadKg = row.Int("payload_kg"),
                CargoVolumeM3 = row.Decimal("cargo_volume_m3"), BatteryKwh = row.Decimal("battery_kwh"), Ownership = row.Text("ownership") ?? "Unknown",
                FleetEntryDate = row.Date("fleet_entry_date"), FleetExitDate = row.Date("fleet_exit_date"), InspectionDueDate = row.Date("inspection_due_date"),
                InsuranceDueDate = row.Date("insurance_due_date"), NextServiceDate = row.Date("next_service_date"), NextServiceKm = row.Long("next_service_km"),
                PreferredServicePartnerId = partner?.Id, Notes = row.Text("notes")
            });
            car.Status = FleetValidation.StatusForOwnership(car.Status, data.Ownership);
            Unique(row, plates, car.Registration);
            if (data.Vin is { } vin) Unique(row, vins, vin);
            if (data.FleetNumber is { } fleetNumber) Unique(row, fleetNumbers, fleetNumber);
            var profile = new VehicleProfile { TenantId = TenantId, VehicleId = car.Id, StatusReason = row.Field("status_reason", 500),
                UpdatedAt = row.Time("source_updated_at"), UpdatedBy = UpdatedBy(row) };
            FleetManagement.Apply(profile, data);
            Add(vehicles, row, "vehicle_ref", new(car, profile));
            db.Vehicles.Add(car);
            db.VehicleProfiles.Add(profile);
            if (row.Text("site_ref") is not null)
            {
                var site = Find(sites, row, "site_ref");
                db.VehicleSiteAssignments.Add(new() { TenantId = TenantId, VehicleId = car.Id, SiteId = site.Id });
            }
            var makeKey = make.Normalize(NormalizationForm.FormKC).ToUpperInvariant();
            var modelKey = model.Normalize(NormalizationForm.FormKC).ToUpperInvariant();
            if (models.Add((makeKey, modelKey)))
                db.VehicleModelOptions.Add(new() { TenantId = TenantId, Make = make, Model = model, MakeKey = makeKey, ModelKey = modelKey });
        });
    }
}

internal sealed record ImportedVehicle(Vehicle Vehicle, VehicleProfile Profile);
