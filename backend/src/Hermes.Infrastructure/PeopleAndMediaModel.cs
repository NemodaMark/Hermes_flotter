using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    public DbSet<UserAvatar> UserAvatars => Set<UserAvatar>();
    public DbSet<VehiclePhoto> VehiclePhotos => Set<VehiclePhoto>();
    public DbSet<VehicleUserAssignment> VehicleUserAssignments => Set<VehicleUserAssignment>();
    public DbSet<VehicleModelOption> VehicleModelOptions => Set<VehicleModelOption>();

    private void ConfigurePeopleAndMedia(ModelBuilder model)
    {
        model.Entity<UserAvatar>(e =>
        {
            e.ToTable("user_avatars", t => t.HasCheckConstraint("CK_user_avatar_bytes", "octet_length(\"Bytes\") BETWEEN 1 AND 5242880"));
            e.HasKey(x => x.UserId);
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.Sha256).HasMaxLength(64);
            e.HasOne<ApplicationUser>().WithOne().HasForeignKey<UserAvatar>(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<VehiclePhoto>(e =>
        {
            VehicleOwned(e, "vehicle_photos");
            e.ToTable(t => { t.HasCheckConstraint("CK_vehicle_photo_slot", "\"Slot\" BETWEEN 1 AND 5"); t.HasCheckConstraint("CK_vehicle_photo_bytes", "octet_length(\"Bytes\") BETWEEN 1 AND 5242880"); });
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.Slot }).IsUnique();
            e.Property(x => x.Sha256).HasMaxLength(64); e.Property(x => x.UploadedBy).HasMaxLength(256);
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<VehicleUserAssignment>(e =>
        {
            VehicleOwned(e, "vehicle_user_assignments");
            e.ToTable(t => t.HasCheckConstraint("CK_vehicle_assignment_dates", "\"ReleasedAt\" IS NULL OR \"ReleasedAt\" >= \"AssignedAt\""));
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.VehicleId }).IsUnique().HasFilter("\"ReleasedAt\" IS NULL");
            e.HasIndex(x => new { x.TenantId, x.UserId, x.ReleasedAt });
            e.Property(x => x.UserId).HasMaxLength(256); e.Property(x => x.AssignedBy).HasMaxLength(256); e.Property(x => x.ReleasedBy).HasMaxLength(256);
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<TenantMembership>().WithMany().HasForeignKey(x => new { x.TenantId, UserSubject = x.UserId }).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<VehicleModelOption>(e =>
        {
            VehicleOwned(e, "vehicle_model_options");
            e.HasKey(x => new { x.TenantId, x.MakeKey, x.ModelKey });
            e.Property(x => x.MakeKey).HasMaxLength(128); e.Property(x => x.ModelKey).HasMaxLength(128);
            e.Property(x => x.Make).HasMaxLength(64); e.Property(x => x.Model).HasMaxLength(64);
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
