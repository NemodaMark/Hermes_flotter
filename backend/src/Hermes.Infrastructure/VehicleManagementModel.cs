using Hermes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    private void VehicleOwned<T>(EntityTypeBuilder<T> e, string table) where T : class, ITenantEntity
    {
        e.ToTable(table);
        e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
    }
    private void ConfigureVehicleManagement(ModelBuilder model)
    {
        model.Entity<VehicleProfile>(e =>
        {
            VehicleOwned(e, "vehicle_profiles");
            e.HasKey(x => new { x.TenantId, x.VehicleId });
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Partner>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.PreferredServicePartnerId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.RegistrationCountry).HasMaxLength(2);
            e.Property(x => x.Vin).HasMaxLength(17);
            e.HasIndex(x => new { x.TenantId, x.Vin }).IsUnique().HasFilter("\"Vin\" IS NOT NULL");
            e.Property(x => x.FleetNumber).HasMaxLength(40);
            e.HasIndex(x => new { x.TenantId, x.FleetNumber }).IsUnique().HasFilter("\"FleetNumber\" IS NOT NULL");
            e.Property(x => x.Category).HasMaxLength(32); e.Property(x => x.Color).HasMaxLength(40);
            e.Property(x => x.BodyType).HasMaxLength(32);
            e.Property(x => x.FuelType).HasMaxLength(32); e.Property(x => x.Transmission).HasMaxLength(32);
            e.Property(x => x.Ownership).HasMaxLength(16);
            e.Property(x => x.PowerKw).HasPrecision(12, 3); e.Property(x => x.BatteryKwh).HasPrecision(12, 3);
            e.Property(x => x.CargoVolumeM3).HasPrecision(12, 3);
            e.Property(x => x.Notes).HasMaxLength(4000); e.Property(x => x.StatusReason).HasMaxLength(500);
            e.Property(x => x.UpdatedBy).HasMaxLength(256);
        });
        model.Entity<VehicleRegistration>(e =>
        {
            VehicleOwned(e, "vehicle_registration_history");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Registration).HasMaxLength(16); e.Property(x => x.CountryCode).HasMaxLength(2);
            e.Property(x => x.RecordedBy).HasMaxLength(256);
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.RecordedAt, x.Id });
            e.HasIndex(x => new { x.TenantId, x.Registration });
        });
        model.Entity<Partner>(e =>
        {
            VehicleOwned(e, "fleet_partners");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Name).HasMaxLength(200); e.Property(x => x.CountryCode).HasMaxLength(2);
            e.Property(x => x.SearchText).HasMaxLength(400);
            e.Property(x => x.PostalCode).HasMaxLength(20); e.Property(x => x.City).HasMaxLength(120);
            e.Property(x => x.AddressLine1).HasMaxLength(200); e.Property(x => x.AddressLine2).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(254); e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Website).HasMaxLength(2048); e.Property(x => x.Notes).HasMaxLength(4000);
            e.Property(x => x.ContactsJson).HasColumnType("jsonb");
            e.Property(x => x.StatusReason).HasMaxLength(500); e.Property(x => x.CreatedBy).HasMaxLength(256); e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.TenantId, x.Name, x.Id });
        });
        model.Entity<VehicleLease>(e =>
        {
            VehicleOwned(e, "vehicle_leases");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Partner>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.PartnerId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.ContractNumber).HasMaxLength(100); e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.BillingFrequency).HasMaxLength(16); e.Property(x => x.Status).HasMaxLength(16);
            e.Property(x => x.PaymentAmount).HasPrecision(18, 2); e.Property(x => x.DocumentUrl).HasMaxLength(2048);
            e.Property(x => x.Notes).HasMaxLength(4000); e.Property(x => x.CreatedBy).HasMaxLength(256); e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.StartDate, x.Id });
        });
        model.Entity<VehicleService>(e =>
        {
            VehicleOwned(e, "vehicle_services");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Partner>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.PartnerId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Description).HasMaxLength(2000); e.Property(x => x.WorkOrderNumber).HasMaxLength(100);
            e.Property(x => x.Currency).HasMaxLength(3); e.Property(x => x.Cost).HasPrecision(18, 2);
            e.Property(x => x.DocumentUrl).HasMaxLength(2048); e.Property(x => x.Notes).HasMaxLength(4000);
            e.Property(x => x.VoidReason).HasMaxLength(500); e.Property(x => x.CreatedBy).HasMaxLength(256); e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.PerformedOn, x.Id });
        });
    }
}
