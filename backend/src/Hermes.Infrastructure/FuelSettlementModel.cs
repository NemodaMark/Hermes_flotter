using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    public DbSet<FuelSettlement> FuelSettlements => Set<FuelSettlement>();
    public DbSet<FuelSettlementPolicy> FuelSettlementPolicies => Set<FuelSettlementPolicy>();
    public DbSet<FuelSettlementVehicle> FuelSettlementVehicles => Set<FuelSettlementVehicle>();
    public DbSet<FuelSettlementHistory> FuelSettlementHistory => Set<FuelSettlementHistory>();
    private void ConfigureFuelSettlements(ModelBuilder model)
    {
        model.Entity<FuelSettlementPolicy>(e => {
            VehicleOwned(e, "fuel_settlement_policies"); e.HasKey(x => new { x.TenantId, x.Month });
            e.Property(x => x.Rules).HasColumnType("jsonb"); e.Property(x => x.Version).IsConcurrencyToken();
            e.ToTable(t => t.HasCheckConstraint("CK_settlement_policy_month", "extract(day from \"Month\") = 1"));
        });
        model.Entity<FuelSettlement>(e => {
            VehicleOwned(e, "fuel_settlements"); e.HasKey(x => new { x.TenantId, x.UserId, x.Month });
            e.Property(x => x.UserId).HasMaxLength(256); e.Property(x => x.UpdatedBy).HasMaxLength(256); e.Property(x => x.ApprovedBy).HasMaxLength(256);
            e.Property(x => x.Data).HasColumnType("jsonb"); e.Property(x => x.Calculation).HasColumnType("jsonb"); e.Property(x => x.Version).IsConcurrencyToken();
            e.HasOne<TenantMembership>().WithMany().HasForeignKey(x => new { x.TenantId, UserSubject = x.UserId }).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => t.HasCheckConstraint("CK_settlement_state", "extract(day from \"Month\") = 1 AND \"Status\" IN ('Draft','Submitted','Approved') AND (\"Status\" = 'Approved') = (\"ApprovedAt\" IS NOT NULL AND \"ApprovedBy\" IS NOT NULL)"));
        });
        model.Entity<FuelSettlementVehicle>(e => {
            VehicleOwned(e, "fuel_settlement_vehicles"); e.HasKey(x => new { x.TenantId, x.UserId, x.Month, x.VehicleId });
            e.Property(x => x.UserId).HasMaxLength(256); e.Property(x => x.SourceMetadata).HasColumnType("jsonb");
            e.HasOne<FuelSettlement>().WithMany().HasForeignKey(x => new { x.TenantId, x.UserId, x.Month }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
        });
        model.Entity<FuelSettlementHistory>(e => {
            VehicleOwned(e, "fuel_settlement_history"); e.HasKey(x => new { x.TenantId, x.UserId, x.Month, x.Version });
            e.Property(x => x.UserId).HasMaxLength(256); e.Property(x => x.Actor).HasMaxLength(256); e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.Snapshot).HasColumnType("jsonb");
            e.HasOne<FuelSettlement>().WithMany().HasForeignKey(x => new { x.TenantId, x.UserId, x.Month }).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
