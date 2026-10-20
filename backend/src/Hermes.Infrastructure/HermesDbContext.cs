using Hermes.Application;
using Hermes.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed class HermesDbContext(DbContextOptions<HermesDbContext> options, ITenantContext tenantContext)
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
    public DbSet<PermissionGroup> PermissionGroups => Set<PermissionGroup>();
    public DbSet<GroupPermission> GroupPermissions => Set<GroupPermission>();
    public DbSet<MembershipGroup> MembershipGroups => Set<MembershipGroup>();
    public DbSet<OdometerReading> OdometerReadings => Set<OdometerReading>();
    public DbSet<CompanyAccessGroup> CompanyAccessGroups => Set<CompanyAccessGroup>();
    public DbSet<CompanyAccessPermission> CompanyAccessPermissions => Set<CompanyAccessPermission>();
    public DbSet<CompanyAccessScope> CompanyAccessScopes => Set<CompanyAccessScope>();
    public DbSet<CompanyAccessUser> CompanyAccessUsers => Set<CompanyAccessUser>();
    public DbSet<CompanyAccessMembership> CompanyAccessMemberships => Set<CompanyAccessMembership>();
    private Guid? CurrentTenantId => tenantContext.TenantId;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
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

        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.ToTable("tenants");
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
        modelBuilder.Entity<CompanyAccessGroup>(entity =>
        {
            entity.ToTable("company_access_groups");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(80);
            entity.Property(x => x.NormalizedName).HasMaxLength(80);
            entity.Property(x => x.CreatedBy).HasMaxLength(256);
            entity.Property(x => x.Version).IsConcurrencyToken();
            entity.Ignore(x => x.EffectivePermissions);
            entity.HasIndex(x => new { x.CreatedBy, x.NormalizedName }).IsUnique();
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CompanyAccessPermission>(entity =>
        {
            entity.ToTable("company_access_permissions");
            entity.HasKey(x => new { x.GroupId, x.Code });
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.HasOne<CompanyAccessGroup>().WithMany(x => x.Permissions).HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<PermissionDefinition>().WithMany().HasForeignKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CompanyAccessScope>(entity =>
        {
            entity.ToTable("company_access_scopes");
            entity.HasKey(x => new { x.GroupId, x.TenantId });
            entity.HasOne<CompanyAccessGroup>().WithMany(x => x.Companies).HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CompanyAccessUser>(entity =>
        {
            entity.ToTable("company_access_users");
            entity.HasKey(x => new { x.GroupId, x.UserId });
            entity.Property(x => x.UserId).HasMaxLength(256);
            entity.HasOne<CompanyAccessGroup>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        modelBuilder.Entity<CompanyAccessMembership>(entity =>
        {
            entity.ToTable("company_access_memberships");
            entity.HasKey(x => new { x.TenantId, x.UserSubject, x.GroupId });
            entity.Property(x => x.UserSubject).HasMaxLength(256);
            entity.HasOne<TenantMembership>().WithMany(x => x.CompanyGroups).HasForeignKey(x => new { x.TenantId, x.UserSubject }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Group).WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CompanyAccessScope>().WithMany().HasForeignKey(x => new { x.GroupId, x.TenantId }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CompanyAccessUser>().WithMany().HasForeignKey(x => new { x.GroupId, UserId = x.UserSubject }).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<PermissionGroup>(entity =>
        {
            entity.ToTable("permission_groups", table => table.HasCheckConstraint("CK_group_admin_name", "\"IsAdmin\" = (\"NormalizedName\" = 'ADMIN')"));
            entity.HasKey(x => new { x.TenantId, x.Id });
            entity.Property(x => x.Name).HasMaxLength(80);
            entity.Property(x => x.NormalizedName).HasMaxLength(80);
            entity.Property(x => x.Version).IsConcurrencyToken();
            entity.Ignore(x => x.EffectivePermissions);
            entity.HasIndex(x => new { x.TenantId, x.NormalizedName }).IsUnique();
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<GroupPermission>(entity =>
        {
            entity.ToTable("permission_group_permissions");
            entity.HasKey(x => new { x.TenantId, x.GroupId, x.Code });
            entity.Property(x => x.Code).HasMaxLength(80);
            entity.HasOne<PermissionGroup>().WithMany(x => x.Permissions).HasForeignKey(x => new { x.TenantId, x.GroupId }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<PermissionDefinition>().WithMany().HasForeignKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        modelBuilder.Entity<MembershipGroup>(entity =>
        {
            entity.ToTable("tenant_membership_groups");
            entity.HasKey(x => new { x.TenantId, x.UserSubject, x.GroupId });
            entity.Property(x => x.UserSubject).HasMaxLength(256);
            entity.HasOne<TenantMembership>().WithMany(x => x.Groups).HasForeignKey(x => new { x.TenantId, x.UserSubject }).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Group).WithMany().HasForeignKey(x => new { x.TenantId, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
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
