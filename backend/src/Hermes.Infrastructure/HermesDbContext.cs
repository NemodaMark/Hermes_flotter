using Hermes.Application;
using Hermes.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext(DbContextOptions<HermesDbContext> options, ITenantContext tenantContext)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantMembership> Memberships => Set<TenantMembership>();
    public DbSet<Vehicle> Vehicles => Set<Vehicle>();
    public DbSet<PermissionDefinition> PermissionDefinitions => Set<PermissionDefinition>();
    public DbSet<MembershipPermission> MembershipPermissions => Set<MembershipPermission>();
    public DbSet<TenantInvitation> Invitations => Set<TenantInvitation>();
    public DbSet<InvitationPermission> InvitationPermissions => Set<InvitationPermission>();
    public DbSet<AccessAuditEvent> AccessAuditEvents => Set<AccessAuditEvent>();
    public DbSet<SystemPermissionGrant> SystemPermissionGrants => Set<SystemPermissionGrant>();
    public DbSet<SystemAuditEvent> SystemAuditEvents => Set<SystemAuditEvent>();
    public DbSet<UserIdentityHistory> UserIdentityHistory => Set<UserIdentityHistory>();
    public DbSet<OdometerReading> OdometerReadings => Set<OdometerReading>();
    public DbSet<PermissionGroup> PermissionGroups => Set<PermissionGroup>();
    public DbSet<GroupPermission> GroupPermissions => Set<GroupPermission>();
    public DbSet<GroupCompany> GroupCompanies => Set<GroupCompany>();
    public DbSet<GroupCompanySite> GroupCompanySites => Set<GroupCompanySite>();
    public DbSet<GroupUser> GroupUsers => Set<GroupUser>();
    public DbSet<GroupUserCompany> GroupUserCompanies => Set<GroupUserCompany>();
    public DbSet<MembershipGroup> MembershipGroups => Set<MembershipGroup>();
    public DbSet<AccountLifecycle> AccountLifecycles => Set<AccountLifecycle>();
    public DbSet<ArchivedTenant> ArchivedTenants => Set<ArchivedTenant>();
    public DbSet<CompanyProfile> CompanyProfiles => Set<CompanyProfile>();
    public DbSet<CompanyContact> CompanyContacts => Set<CompanyContact>();
    public DbSet<Site> Sites => Set<Site>();
    public DbSet<VehicleSiteAssignment> VehicleSiteAssignments => Set<VehicleSiteAssignment>();
    public DbSet<VehicleProfile> VehicleProfiles => Set<VehicleProfile>();
    public DbSet<VehicleRegistration> VehicleRegistrations => Set<VehicleRegistration>();
    public DbSet<Partner> Partners => Set<Partner>();
    public DbSet<VehicleLease> VehicleLeases => Set<VehicleLease>();
    public DbSet<VehicleService> VehicleServices => Set<VehicleService>();
    public DbSet<VehicleDocument> VehicleDocuments => Set<VehicleDocument>();
    public DbSet<VehicleDocumentContent> VehicleDocumentContents => Set<VehicleDocumentContent>();
    private Guid? CurrentTenantId => tenantContext.TenantId;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        ConfigureOrganizations(modelBuilder);
        ConfigureVehicleManagement(modelBuilder);
        ConfigureDocuments(modelBuilder);
        modelBuilder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("identity_users", table => table.HasCheckConstraint("CK_identity_users_username_key", UserNames.KeyConstraint));
            entity.Property(x => x.DisplayName).HasMaxLength(120);
            entity.Property(x => x.PhoneNumber).HasMaxLength(40);
            entity.Property(x => x.ProfileVersion).HasDefaultValue(1L).IsConcurrencyToken();
            entity.HasIndex(x => x.NormalizedEmail).HasDatabaseName("EmailIndex").IsUnique();
        });
        modelBuilder.Entity<IdentityRole>().ToTable("identity_roles");
        modelBuilder.Entity<IdentityUserClaim<string>>().ToTable("identity_user_claims");
        modelBuilder.Entity<IdentityUserLogin<string>>().ToTable("identity_user_logins");
        modelBuilder.Entity<IdentityUserToken<string>>().ToTable("identity_user_tokens");
        modelBuilder.Entity<IdentityUserRole<string>>().ToTable("identity_user_roles");
        modelBuilder.Entity<IdentityRoleClaim<string>>().ToTable("identity_role_claims");

        modelBuilder.Entity<UserIdentityHistory>(entity =>
        {
            entity.ToTable("user_identity_history");
            entity.HasKey(x => x.PreviousId);
            entity.Property(x => x.ReservedName).HasComputedColumnSql("lower(\"PreviousId\")", stored: true);
            entity.HasIndex(x => x.ReservedName);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SystemPermissionGrant>(entity =>
        {
            entity.ToTable("system_permission_grants");
            entity.HasKey(x => new { x.UserId, x.Code });
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<SystemAuditEvent>(entity =>
        {
            entity.ToTable("system_audit_events");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.ActorSubject).HasMaxLength(256);
            entity.Property(x => x.TargetSubject).HasMaxLength(256);
            entity.Property(x => x.Action).HasMaxLength(80);
            entity.Property(x => x.Details).HasColumnType("jsonb");
            entity.HasIndex(x => new { x.CreatedAt, x.Id });
        });

        modelBuilder.Entity<AccountLifecycle>(entity =>
        {
            entity.ToTable("account_lifecycles");
            entity.HasKey(x => x.UserId);
            entity.Property(x => x.Reason).HasMaxLength(200);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<ArchivedTenant>(entity =>
        {
            entity.ToTable("archived_tenants");
            entity.HasKey(x => x.TenantId);
            entity.Property(x => x.Reason).HasMaxLength(200);
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.Property(x => x.Reason).HasMaxLength(500);
            entity.Property(x => x.Status).HasMaxLength(16).HasDefaultValue("Archived");
        });
        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.ToTable("tenants");
            entity.HasQueryFilter(x => !ArchivedTenants.Any(a => a.TenantId == x.Id));
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(160);
            entity.Property(x => x.TimeZone).HasMaxLength(80);
        });

        modelBuilder.Entity<TenantMembership>(entity =>
        {
            entity.ToTable("tenant_memberships");
            entity.Ignore(x => x.EffectivePermissions);
            entity.Ignore(x => x.HasCompanyAccess);
            entity.Ignore(x => x.HasAdminAuthority);
            entity.HasKey(x => new { x.TenantId, x.UserSubject });
            entity.Property(x => x.UserSubject).HasMaxLength(256);
            entity.Property(x => x.Version).IsConcurrencyToken();
            entity.Property(x => x.Version).HasDefaultValue(1L);
            entity.Property(x => x.IsActive).HasDefaultValue(true);
            entity.Property(x => x.HasDirectAccess).HasDefaultValue(true);
            entity.HasIndex(x => x.UserSubject);
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<PermissionDefinition>(entity =>
        {
            entity.ToTable("permission_definitions");
            entity.HasKey(x => x.Code);
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.Property(x => x.Name).HasMaxLength(160);
            entity.HasData(Permissions.Catalog.Select(item => new PermissionDefinition { Code = item.Code, Name = item.Name }));
        });
        modelBuilder.Entity<MembershipPermission>(entity =>
        {
            entity.ToTable("tenant_membership_permissions");
            entity.HasKey(x => new { x.TenantId, x.UserSubject, x.Code });
            entity.Property(x => x.UserSubject).HasMaxLength(256);
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.HasOne<TenantMembership>().WithMany(x => x.Permissions).HasForeignKey(x => new { x.TenantId, x.UserSubject }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<PermissionDefinition>().WithMany().HasForeignKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<PermissionGroup>(entity =>
        {
            entity.ToTable("company_access_groups");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(80);
            entity.Property(x => x.NormalizedName).HasMaxLength(80);
            entity.Property(x => x.CreatedBy).HasMaxLength(256);
            entity.Property(x => x.Version).IsConcurrencyToken();
            entity.Ignore(x => x.EffectivePermissions);
            entity.HasIndex(x => x.NormalizedName);
            entity.HasIndex(x => x.IsAdmin).IsUnique().HasFilter("\"IsAdmin\"");
            // CreatedBy is historical provenance, including migrated actors without an identity account.
        });
        modelBuilder.Entity<GroupPermission>(entity =>
        {
            entity.ToTable("company_access_permissions");
            entity.HasKey(x => new { x.GroupId, x.Code });
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.HasOne<PermissionGroup>().WithMany(x => x.Permissions).HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<PermissionDefinition>().WithMany().HasForeignKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<GroupCompany>(entity =>
        {
            entity.ToTable("company_access_scopes");
            entity.HasKey(x => new { x.GroupId, x.TenantId });
            entity.HasOne<PermissionGroup>().WithMany(x => x.Companies).HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<GroupCompanySite>(entity =>
        {
            entity.ToTable("company_access_site_scopes");
            entity.HasKey(x => new { x.GroupId, x.TenantId, x.SiteId });
            entity.HasOne<GroupCompany>().WithMany(x => x.Sites).HasForeignKey(x => new { x.GroupId, x.TenantId }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Site>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.SiteId }).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<GroupUser>(entity =>
        {
            entity.ToTable("company_access_users");
            entity.HasKey(x => new { x.GroupId, x.UserId });
            entity.Property(x => x.UserId).HasMaxLength(256);
            entity.HasOne<PermissionGroup>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
            // Preserve legacy subjects. New assignments require a real account in GroupManagement.
        });
        modelBuilder.Entity<GroupUserCompany>(entity =>
        {
            entity.ToTable("group_user_companies");
            entity.HasKey(x => new { x.GroupId, x.UserId, x.TenantId });
            entity.Property(x => x.UserId).HasMaxLength(256);
            entity.HasOne<GroupUser>().WithMany().HasForeignKey(x => new { x.GroupId, x.UserId }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<GroupCompany>().WithMany().HasForeignKey(x => new { x.GroupId, x.TenantId }).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<MembershipGroup>(entity =>
        {
            entity.ToTable("company_access_memberships");
            entity.HasKey(x => new { x.TenantId, x.UserSubject, x.GroupId });
            entity.Property(x => x.UserSubject).HasMaxLength(256);
            entity.HasOne<TenantMembership>().WithMany(x => x.Groups).HasForeignKey(x => new { x.TenantId, x.UserSubject }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Group).WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<GroupCompany>().WithMany().HasForeignKey(x => new { x.GroupId, x.TenantId }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<GroupUser>().WithMany().HasForeignKey(x => new { x.GroupId, UserId = x.UserSubject }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<GroupUserCompany>().WithMany().HasForeignKey(x => new { x.GroupId, UserId = x.UserSubject, x.TenantId }).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<OdometerReading>(entity =>
        {
            entity.ToTable("vehicle_odometer_readings");
            entity.HasKey(x => new { x.TenantId, x.Id });
            entity.Property(x => x.RecordedBy).HasMaxLength(256);
            entity.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(x => new { x.TenantId, x.VehicleId, x.RecordedAt });
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<TenantInvitation>(entity =>
        {
            entity.ToTable("tenant_invitations");
            entity.HasKey(x => new { x.TenantId, x.Id });
            entity.Property(x => x.Email).HasMaxLength(254);
            entity.Property(x => x.NormalizedEmail).HasMaxLength(254);
            entity.Property(x => x.TokenHash).HasMaxLength(64);
            entity.Property(x => x.InvitedBy).HasMaxLength(256);
            entity.HasIndex(x => new { x.TenantId, x.NormalizedEmail }).IsUnique().HasFilter("\"AcceptedAt\" IS NULL AND \"RevokedAt\" IS NULL");
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<InvitationPermission>(entity =>
        {
            entity.ToTable("tenant_invitation_permissions");
            entity.HasKey(x => new { x.TenantId, x.InvitationId, x.Code });
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.HasOne<TenantInvitation>().WithMany(x => x.Permissions).HasForeignKey(x => new { x.TenantId, x.InvitationId }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<PermissionDefinition>().WithMany().HasForeignKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<AccessAuditEvent>(entity =>
        {
            entity.ToTable("access_audit_events");
            entity.HasKey(x => new { x.TenantId, x.Id });
            entity.Property(x => x.ActorSubject).HasMaxLength(256);
            entity.Property(x => x.TargetSubject).HasMaxLength(256);
            entity.Property(x => x.Action).HasMaxLength(80);
            entity.Property(x => x.Details).HasColumnType("jsonb");
            entity.HasIndex(x => new { x.TenantId, x.CreatedAt, x.Id });
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });

        modelBuilder.Entity<Vehicle>(entity =>
        {
            entity.ToTable("vehicles");
            entity.Property(x => x.Version).HasDefaultValue(1L).IsConcurrencyToken();
            entity.HasKey(x => new { x.TenantId, x.Id });
            entity.Property(x => x.Registration).HasMaxLength(16);
            entity.Property(x => x.Make).HasMaxLength(64);
            entity.Property(x => x.Model).HasMaxLength(64);
            entity.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(x => new { x.TenantId, x.Registration }).IsUnique();
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        => SaveChangesAsync(true, cancellationToken);

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        ValidateTenantWrites();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ValidateTenantWrites();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    private void ValidateTenantWrites()
    {
        foreach (var entry in ChangeTracker.Entries().Where(entry => entry.Entity is ITenantEntity))
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            if (tenantContext.TenantId is null || ((ITenantEntity)entry.Entity).TenantId != tenantContext.TenantId)
                throw new InvalidOperationException("A tenant-owned write requires a matching tenant context.");
            if (entry.State != EntityState.Added && entry.Property("TenantId").IsModified)
                throw new InvalidOperationException("An entity cannot be moved between tenants.");
        }
    }
}
