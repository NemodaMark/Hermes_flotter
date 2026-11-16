using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Hermes.Application;
using Hermes.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Hermes.Infrastructure;

public sealed record CsvImportOptions(bool Apply = false, string? Owner = null, Guid? EntraTenantId = null,
    bool RequireEmailConfirmation = false);

public sealed record CsvImportResult(string Status, string Fingerprint, IReadOnlyDictionary<string, int> Rows,
    IReadOnlyDictionary<string, Guid> Companies, int NewLocalAccounts, int ExistingAccounts);

public static class CsvImport
{
    internal const string Actor = "import:database-operator";
    private const string Receipt = "data.csv_imported";
    private const string EntraProvider = "MicrosoftEntra";

    public static async Task<CsvImportResult> RunAsync(HermesDbContext db, string path, CsvImportOptions options, CancellationToken ct)
    {
        using var package = new CsvImportPackage(path, ct);
        var companies = ReadCompanies(package);
        var companyRefs = companies.ToDictionary(x => x.Reference, x => x.Company.Id, StringComparer.Ordinal);
        var fileRefs = new HashSet<(string?, string)>();
        foreach (var row in package.Rows("files")) Unique(row, fileRefs, (row.Text("company_ref"), row.Require("file_ref")));
        foreach (var table in package.Counts.Keys)
        foreach (var row in package.Rows(table))
        {
            if (!CsvImportPackage.IsCompanyScoped(table)) continue;
            var company = row.Text("company_ref");
            if (company is null && (table == "audit_events" || table == "files" && row.Text("owner_kind") == "avatar")) continue;
            if (company is null || !companyRefs.ContainsKey(company)) throw row.Error("Ismeretlen vagy hiányzó company_ref.");
        }

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        // Serializes maintenance imports, including the replay check and company name reservations.
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(74244530156859)", ct);
        if (await db.SystemAuditEvents.AsNoTracking().AnyAsync(e => e.Action == Receipt && e.TargetSubject == package.Fingerprint, ct))
        {
            foreach (var row in package.Rows("files"))
            {
                ct.ThrowIfCancellationRequested();
                package.Attachment(row, DocumentLimits.FileBytes);
            }
            return new("already_imported", package.Fingerprint, package.Counts, new Dictionary<string, Guid>(), 0, 0);
        }

        var existingNames = await db.Tenants.IgnoreQueryFilters().Select(x => x.Name).ToListAsync(ct);
        var names = existingNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var company in companies)
        {
            if (!names.Add(company.Company.Name)) throw company.Row.Error("Ezen a néven már létezik cég. Az import új cégeket hoz létre.");
            db.Tenants.Add(company.Company);
        }
        var users = await ImportUsers(db, package, options, ct);
        var owner = await FindOwner(db, options.Owner, ct);
        var hasSystemManager = await db.SystemPermissionGrants.AnyAsync(g => g.Code == SystemPermissions.Manage
            && !db.AccountLifecycles.Any(a => a.UserId == g.UserId && a.IsArchived), ct);
        var groups = ImportGroups(db, package, users);
        var adminGroup = await db.PermissionGroups.AsNoTracking().SingleAsync(g => g.IsAdmin, ct);
        await db.SaveChangesAsync(ct);

        foreach (var company in companies)
        {
            var tenant = new TenantContext();
            tenant.Set(company.Company.Id, Actor, Permissions.All);
            var contextOptions = new DbContextOptionsBuilder<HermesDbContext>().UseNpgsql(db.Database.GetDbConnection()).Options;
            await using var scoped = new HermesDbContext(contextOptions, tenant);
            await scoped.Database.UseTransactionAsync(tx.GetDbTransaction(), ct);
            await scoped.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('app.tenant_id', {company.Company.Id.ToString()}, true)", ct);
            await new CsvImportCompany(scoped, package, company, users, groups, adminGroup.Id, owner, hasSystemManager).RunAsync(ct);
        }
        await ImportAvatars(db, package, users, ct);
        foreach (var row in package.Rows("audit_events").Where(row => row.Text("company_ref") is null))
            ReadRow(row, () => db.SystemAuditEvents.Add(new()
            {
                Action = "data.legacy_event", ActorSubject = users.Actor(row, "actor_ref"), TargetSubject = row.Field("entity_ref", 256),
                CreatedAt = row.Time("occurred_at") ?? throw row.Error("Kötelező mező: occurred_at."),
                Details = LegacyEvent(row)
            }));
        foreach (var table in package.Counts.Keys)
        foreach (var row in package.Rows(table))
        {
            if ((!CsvImportPackage.IsCompanyScoped(table) || row.Text("company_ref") is null)
                && ReadRow(row, () => Provenance(row, users)) is { } provenance)
                db.SystemAuditEvents.Add(new() { Action = "data.csv_provenance", ActorSubject = Actor, Details = JsonSerializer.Serialize(provenance) });
            row.VerifyColumns();
        }

        db.SystemAuditEvents.Add(new()
        {
            Action = Receipt, ActorSubject = Actor, TargetSubject = package.Fingerprint,
            Details = JsonSerializer.Serialize(new { owner, companies = companyRefs, rows = package.Counts })
        });
        await db.SaveChangesAsync(ct);
        if (options.Apply) await tx.CommitAsync(ct);
        else await tx.RollbackAsync(ct);
        db.ChangeTracker.Clear();
        return new(options.Apply ? "imported" : "validated", package.Fingerprint, package.Counts, companyRefs,
            users.NewLocalAccounts, users.ExistingAccounts);
    }

    private static ImportCompany[] ReadCompanies(CsvImportPackage package)
    {
        var references = new HashSet<string>(StringComparer.Ordinal);
        return package.Rows("companies").Select(row => ReadRow(row, () =>
        {
            var reference = row.Require("company_ref");
            Unique(row, references, reference);
            var data = OrganizationValidation.Company(new(row.Require("name"), row.Text("legal_name"), row.Text("tax_number"),
                row.Text("registration_number"), row.Text("eu_vat_number"), Address(row), row.Text("email"), row.Text("phone"),
                row.Text("website"), row.Require("time_zone"), row.Require("currency"), row.Require("distance_unit"), 1));
            return new ImportCompany(reference, new() { Id = Guid.CreateVersion7(), Name = data.Name, TimeZone = data.TimeZone }, data, row);
        })).ToArray();
    }

    private static async Task<string?> FindOwner(HermesDbContext db, string? owner, CancellationToken ct)
    {
        if (owner is null) return null;
        var id = UserNames.Normalize(owner);
        if (!await db.SystemPermissionGrants.AnyAsync(g => g.UserId == id && g.Code == SystemPermissions.Manage
            && !db.AccountLifecycles.Any(a => a.UserId == id && a.IsArchived), ct))
            throw new InvalidDataException("A --owner értéke egy aktív, rendszerszintű kezelő felhasználóneve legyen.");
        return id;
    }

    private static async Task<ImportUsers> ImportUsers(HermesDbContext db, CsvImportPackage package, CsvImportOptions settings, CancellationToken ct)
    {
        var users = new ImportUsers();
        var usernames = new HashSet<string>(StringComparer.Ordinal);
        var emails = new HashSet<string>(StringComparer.Ordinal);
        var entries = new HashSet<Guid>();
        foreach (var row in package.Rows("users"))
        {
            ct.ThrowIfCancellationRequested();
            var name = UserNames.Normalize(row.Require("username"));
            var email = row.Require("email");
            var normalizedEmail = email.Normalize().ToUpperInvariant();
            var display = row.Require("display_name");
            if (!UserNames.IsValid(name) || !UserAccounts.ValidEmail(email)) throw row.Error("Érvénytelen felhasználónév vagy e-mail-cím.");
            ReadRow(row, () => { UserAccounts.ValidateName(display); return true; });
            Unique(row, usernames, name);
            Unique(row, emails, normalizedEmail);
            var phone = ReadRow(row, () => row.Field("phone", 40));
            var archived = row.Bool("is_archived", false);
            var archivedAt = row.Time("archived_at");
            var archiveReason = ReadRow(row, () => row.Field("archive_reason", 200));
            var entra = row.Uuid("entra_object_id");
            if (entra is { } objectId)
            {
                Unique(row, entries, objectId);
                if (settings.EntraTenantId is null) throw row.Error("Entra Object ID-hoz az importnál is beállított Microsoft-címtár szükséges.");
            }
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({name}, 157422991))", ct);
            var existing = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == name, ct);
            if (existing is not null)
            {
                if (existing.NormalizedEmail != normalizedEmail) throw row.Error("A felhasználónév már létezik másik e-mail-címmel.");
                var lifecycle = await db.AccountLifecycles.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == name, ct);
                if (archived && lifecycle?.IsArchived != true) throw row.Error("Az import meglévő aktív fiókot nem archiválhat.");
                if (entra is not null && !await db.Set<IdentityUserLogin<string>>().AnyAsync(x => x.UserId == name
                     && x.LoginProvider == EntraProvider && x.ProviderKey == EntraKey(settings.EntraTenantId!.Value, entra.Value), ct))
                    throw row.Error("A meglévő fiók Entra-hozzárendelése eltér az exporttól.");
                users.Add(row, name, lifecycle?.IsArchived == true || lifecycle?.DevelopmentOnly == true, existing: true);
                continue;
            }
            if (await db.UserIdentityHistory.AnyAsync(x => x.ReservedName == name, ct)
                || await db.Users.AnyAsync(x => x.NormalizedEmail == normalizedEmail, ct))
                throw row.Error("A felhasználónév fenntartott vagy az e-mail-cím egy másik fiókhoz tartozik.");

            var user = new ApplicationUser
            {
                Id = name, UserName = name, NormalizedUserName = name.ToUpperInvariant(), DisplayName = display,
                Email = email, NormalizedEmail = normalizedEmail, PhoneNumber = phone, SecurityStamp = Guid.NewGuid().ToString("N"),
                EmailConfirmationRequired = entra is null && settings.RequireEmailConfirmation, LockoutEnabled = true
            };
            if (entra is { } id)
                db.Set<IdentityUserLogin<string>>().Add(new()
                {
                    UserId = name, LoginProvider = EntraProvider, ProviderKey = EntraKey(settings.EntraTenantId!.Value, id),
                    ProviderDisplayName = "Microsoft Entra ID"
                });
            else
            {
                // An unshared random password enables the existing email reset flow without importing credentials.
                user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, Convert.ToHexString(RandomNumberGenerator.GetBytes(32)));
                users.NewLocalAccounts++;
            }
            db.Users.Add(user);
            db.UserIdentityHistory.Add(new() { PreviousId = name, UserId = name });
            if (archived) db.AccountLifecycles.Add(new() { UserId = name, IsArchived = true, ArchivedAt = archivedAt, Reason = archiveReason });
            users.Add(row, name, archived, existing: false);
        }
        return users;
    }

    private static Dictionary<string, ImportedGroup> ImportGroups(HermesDbContext db, CsvImportPackage package, ImportUsers users)
    {
        var groups = new Dictionary<string, ImportedGroup>(StringComparer.Ordinal);
        foreach (var row in package.Rows("groups"))
        {
            var reference = row.Require("group_ref");
            var name = row.Require("name");
            var normalized = name.Normalize().ToUpperInvariant();
            if (name.Length > 80 || normalized.Length > 80 || normalized == "ADMIN") throw row.Error("Érvénytelen vagy védett csoportnév.");
            var mode = row.Text("dashboard_mode") ?? "Overview";
            var priority = row.Int("dashboard_priority") ?? 0;
            if (mode is not ("Overview" or "Vehicle") || priority is < 0 or > 1000) throw row.Error("Érvénytelen kezdőlapbeállítás.");
            var group = new PermissionGroup { Name = name, NormalizedName = normalized, AllPermissions = row.Bool("all_permissions", false),
                DashboardMode = mode, DashboardPriority = priority, CreatedBy = Actor };
            if (!groups.TryAdd(reference, new(group))) throw row.Error("Ismétlődő group_ref.");
            db.PermissionGroups.Add(group);
        }
        foreach (var row in package.Rows("group_permissions"))
        {
            var group = FindGroup(groups, row);
            var code = Permission(row);
            Unique(row, group.Permissions, code);
            db.GroupPermissions.Add(new() { GroupId = group.Group.Id, Code = code });
        }
        foreach (var row in package.Rows("group_users"))
        {
            var group = FindGroup(groups, row);
            var user = users.Find(row).Name;
            Unique(row, group.Users, user);
            db.GroupUsers.Add(new() { GroupId = group.Group.Id, UserId = user });
        }
        var scopedGroups = package.Rows("group_companies").Select(row => FindGroup(groups, row).Group.Id).ToHashSet();
        if (groups.Values.Any(group => !scopedGroups.Contains(group.Group.Id)))
            throw new InvalidDataException("Minden saját csoporthoz legalább egy cég szükséges a group_companies.csv-ben.");
        return groups;
    }

    internal static ImportedGroup FindGroup(Dictionary<string, ImportedGroup> groups, CsvImportRow row)
        => groups.TryGetValue(row.Require("group_ref"), out var group) ? group : throw row.Error("Ismeretlen group_ref.");

    private static string EntraKey(Guid tenantId, Guid objectId) => $"{tenantId:D}:{objectId:D}";
    internal static AddressInput Address(CsvImportRow row) => new(row.Require("country_code"), row.Text("postal_code"),
        row.Text("city"), row.Text("address_line_1"), row.Text("address_line_2"));
    internal static string Permission(CsvImportRow row)
    {
        var code = row.Require("permission_code");
        return Permissions.All.Contains(code, StringComparer.Ordinal) ? code : throw row.Error("Ismeretlen céges jogosultság.");
    }
    internal static string LegacyEvent(CsvImportRow row)
    {
        JsonElement? details = null;
        if (row.Text("details_json") is { } json)
        {
            try
            {
                using var parsed = JsonDocument.Parse(json);
                details = parsed.RootElement.Clone();
            }
            catch (JsonException) { throw row.Error("A details_json nem érvényes JSON."); }
        }
        return JsonSerializer.Serialize(new { sourceEvent = row.Require("event_ref"), action = row.Require("action"),
            entityType = row.Require("entity_type"), entityRef = row.Require("entity_ref"), details });
    }
    internal static object? Provenance(CsvImportRow row, ImportUsers users)
    {
        var createdAt = row.HasUnread("source_created_at") ? row.Time("source_created_at") : null;
        var updatedAt = row.HasUnread("source_updated_at") ? row.Time("source_updated_at") : null;
        var createdBy = row.HasUnread("source_created_by") ? users.OptionalActor(row, "source_created_by") : null;
        var updatedBy = row.HasUnread("source_updated_by") ? users.OptionalActor(row, "source_updated_by") : null;
        return createdAt is null && updatedAt is null && createdBy is null && updatedBy is null
            ? null : new { row.File, row.Line, createdAt, createdBy, updatedAt, updatedBy };
    }
    internal static T ReadRow<T>(CsvImportRow row, Func<T> action)
    {
        try { return action(); }
        catch (ManagementException error) { throw row.Error(error.Message); }
    }
    internal static void Unique<T>(CsvImportRow row, HashSet<T> keys, T key)
    {
        if (!keys.Add(key)) throw row.Error("Ismétlődő azonosító vagy hozzárendelés.");
    }

    private static async Task ImportAvatars(HermesDbContext db, CsvImportPackage package, ImportUsers users, CancellationToken ct)
    {
        foreach (var row in package.Rows("files").Where(row => row.Text("owner_kind") == "avatar"))
        {
            var person = users.Find(row, "owner_ref");
            if (row.Text("company_ref") is not null) throw row.Error("A profilkép felhasználóhoz, nem céghez tartozik.");
            var file = ReadRow(row, () => CsvImportCompany.FileMetadata(row, photo: true));
            if (file.Slot is not null) throw row.Error("A slot csak járműfotóhoz adható meg.");
            var image = ReadRow(row, () => CsvImportCompany.ReadImage(package, row, file, avatar: true));
            if (await db.UserAvatars.AnyAsync(x => x.UserId == person.Name, ct)) throw row.Error("A felhasználónak már van profilképe.");
            db.UserAvatars.Add(new() { UserId = person.Name, Bytes = image, Sha256 = Convert.ToHexStringLower(SHA256.HashData(image)),
                UpdatedAt = file.At });
            db.SystemAuditEvents.Add(new() { ActorSubject = users.Actor(row, "uploaded_by_ref"), TargetSubject = person.Name,
                Action = "data.csv_avatar_imported", CreatedAt = file.At, Details = JsonSerializer.Serialize(new { sourceFile = row.Require("file_ref"), file.Name }) });
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }
    }
}

internal sealed record ImportCompany(string Reference, Tenant Company, CompanyInput Data, CsvImportRow Row);
internal sealed record ImportedGroup(PermissionGroup Group)
{
    public HashSet<string> Permissions { get; } = new(StringComparer.Ordinal);
    public HashSet<string> Users { get; } = new(StringComparer.Ordinal);
}
internal sealed record ImportUser(string Name, bool Archived);
internal sealed class ImportUsers
{
    private readonly Dictionary<string, ImportUser> items = new(StringComparer.Ordinal);
    public int NewLocalAccounts { get; set; }
    public int ExistingAccounts { get; private set; }
    public void Add(CsvImportRow row, string name, bool archived, bool existing)
    {
        if (!items.TryAdd(row.Require("user_ref"), new(name, archived))) throw row.Error("Ismétlődő user_ref.");
        if (existing) ExistingAccounts++;
    }
    public ImportUser Find(CsvImportRow row, string key = "user_ref") => items.TryGetValue(row.Require(key), out var user)
        ? user : throw row.Error($"Ismeretlen felhasználói hivatkozás: {key}.");
    public ImportUser? Optional(CsvImportRow row, string key) => row.Text(key) is null ? null : Find(row, key);
    public string Actor(CsvImportRow row, string key) => row.Text(key) is { } value
        ? items.TryGetValue(value, out var user) ? user.Name : row.Field(key, 248)!.Insert(0, "legacy:") : CsvImport.Actor;
    public string? OptionalActor(CsvImportRow row, string key) => row.Text(key) is null ? null : Actor(row, key);
}
