using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    public DbSet<MileageAccount> MileageAccounts => Set<MileageAccount>();
    public DbSet<MileageMonth> MileageMonths => Set<MileageMonth>();
    public DbSet<MileageEntry> MileageEntries => Set<MileageEntry>();

    private void ConfigureMileage(ModelBuilder model)
    {
        model.Entity<MileageAccount>(e =>
        {
            VehicleOwned(e, "mileage_accounts");
            e.HasKey(x => new { x.TenantId, x.UserId });
            e.HasOne<TenantMembership>().WithMany().HasForeignKey(x => new { x.TenantId, UserSubject = x.UserId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.Mode).HasMaxLength(16);
            e.Property(x => x.Version).HasDefaultValue(1L).IsConcurrencyToken();
            e.ToTable(t => t.HasCheckConstraint("CK_mileage_account", "\"Mode\" IN ('Entries','Monthly') AND (\"MonthlyLimitKm\" IS NULL OR \"MonthlyLimitKm\" BETWEEN 0 AND 100000000) AND extract(day from \"FirstMonth\") = 1"));
        });
        model.Entity<MileageMonth>(e =>
        {
            VehicleOwned(e, "mileage_months");
            e.HasKey(x => new { x.TenantId, x.UserId, x.Month });
            e.HasOne<MileageAccount>().WithMany().HasForeignKey(x => new { x.TenantId, x.UserId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.Mode).HasMaxLength(16);
            e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).HasDefaultValue(1L).IsConcurrencyToken();
            e.ToTable(t => t.HasCheckConstraint("CK_mileage_month", "\"Mode\" IN ('Entries','Monthly') AND \"TotalKm\" BETWEEN 0 AND 100000000 AND \"PrivateKm\" BETWEEN 0 AND \"TotalKm\" AND extract(day from \"Month\") = 1"));
        });
        model.Entity<MileageEntry>(e =>
        {
            VehicleOwned(e, "mileage_entries");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<MileageMonth>().WithMany().HasForeignKey(x => new { x.TenantId, x.UserId, x.Month }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.TenantId, x.Source, x.SourceId }).IsUnique();
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.StartKilometers });
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.Source).HasMaxLength(16);
            e.Property(x => x.RecordedBy).HasMaxLength(256);
            e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).HasDefaultValue(1L).IsConcurrencyToken();
            e.ToTable(t => t.HasCheckConstraint("CK_mileage_entry", "\"TotalKm\" BETWEEN 0 AND 100000000 AND \"PrivateKm\" BETWEEN 0 AND \"TotalKm\" AND date_trunc('month', \"OccurredOn\"::timestamp)::date = \"Month\""));
            e.ToTable(t => t.HasCheckConstraint("CK_mileage_interval", "(\"StartKilometers\" IS NULL AND \"EndKilometers\" IS NULL) OR (\"StartKilometers\" IS NOT NULL AND \"EndKilometers\" IS NOT NULL AND \"StartKilometers\" >= 0 AND \"EndKilometers\" - \"StartKilometers\" = \"TotalKm\" AND \"EndKilometers\" <= 100000000)"));
        });
    }
}
