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
    private Guid? CurrentTenantId => tenantContext.TenantId;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("identity_users");
            entity.Property(x => x.DisplayName).HasMaxLength(120);
            entity.HasIndex(x => x.NormalizedEmail).HasDatabaseName("EmailIndex").IsUnique();
        });
        modelBuilder.Entity<IdentityRole>().ToTable("identity_roles");
        modelBuilder.Entity<IdentityUserClaim<string>>().ToTable("identity_user_claims");
        modelBuilder.Entity<IdentityUserLogin<string>>().ToTable("identity_user_logins");
        modelBuilder.Entity<IdentityUserToken<string>>().ToTable("identity_user_tokens");
        modelBuilder.Entity<IdentityUserRole<string>>().ToTable("identity_user_roles");
        modelBuilder.Entity<IdentityRoleClaim<string>>().ToTable("identity_role_claims");

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
            entity.HasKey(x => new { x.TenantId, x.UserSubject });
            entity.Property(x => x.UserSubject).HasMaxLength(256);
            entity.Property(x => x.Role).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(x => x.UserSubject);
            entity.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Vehicle>(entity =>
        {
            entity.ToTable("vehicles");
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
        foreach (var entry in ChangeTracker.Entries<Vehicle>())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;
            if (tenantContext.TenantId is null || entry.Entity.TenantId != tenantContext.TenantId)
                throw new InvalidOperationException("A vehicle write requires a matching tenant context.");
            if (entry.State != EntityState.Added && entry.Property(x => x.TenantId).IsModified)
                throw new InvalidOperationException("A vehicle cannot be moved between tenants.");
        }
    }
}
