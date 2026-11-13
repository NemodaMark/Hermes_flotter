using Hermes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    public DbSet<VehicleBookingSettings> VehicleBookingSettings => Set<VehicleBookingSettings>();
    public DbSet<VehicleBooking> VehicleBookings => Set<VehicleBooking>();
    public DbSet<VehicleServiceAppointment> VehicleServiceAppointments => Set<VehicleServiceAppointment>();
    public DbSet<VehicleFuelEntry> VehicleFuelEntries => Set<VehicleFuelEntry>();
    public DbSet<VehicleHandover> VehicleHandovers => Set<VehicleHandover>();
    public DbSet<VehicleReminderDelivery> VehicleReminderDeliveries => Set<VehicleReminderDelivery>();

    private void ConfigureFleetOperations(ModelBuilder model)
    {
        model.Entity<VehicleBookingSettings>(e =>
        {
            Operation(e, "vehicle_booking_settings");
            e.HasKey(x => new { x.TenantId, x.VehicleId });
        });
        model.Entity<VehicleBooking>(e =>
        {
            Operation(e, "vehicle_bookings");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.StartsOn });
            e.HasOne<TenantMembership>().WithMany().HasForeignKey(x => new { x.TenantId, UserSubject = x.UserId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.CancelledBy).HasMaxLength(256);
            e.ToTable(t => t.HasCheckConstraint("CK_vehicle_booking_duration", """ "EndsOn" - "StartsOn" BETWEEN 0 AND 6 """));
        });
        model.Entity<VehicleServiceAppointment>(e =>
        {
            Operation(e, "vehicle_service_appointments");
            e.HasKey(x => new { x.TenantId, x.VehicleId });
            e.Property(x => x.Notes).HasMaxLength(500);
        });
        model.Entity<VehicleFuelEntry>(e =>
        {
            Operation(e, "vehicle_fuel_entries");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.FueledOn });
            e.Property(x => x.RecordedBy).HasMaxLength(256);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.Liters).HasPrecision(9, 3);
            e.Property(x => x.Amount).HasPrecision(14, 2);
            e.ToTable(t => t.HasCheckConstraint("CK_vehicle_fuel_values", """ "Kilometers" BETWEEN 0 AND 100000000 AND "Liters" > 0 AND "Amount" >= 0 AND ("Receipt" IS NULL OR octet_length("Receipt") BETWEEN 1 AND 5242880) """));
        });
        model.Entity<VehicleHandover>(e =>
        {
            Operation(e, "vehicle_handovers");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.RecordedAt });
            e.Property(x => x.PreviousUserId).HasMaxLength(256);
            e.Property(x => x.NextUserId).HasMaxLength(256);
            e.Property(x => x.RecordedBy).HasMaxLength(256);
            e.Property(x => x.Condition).HasMaxLength(200);
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.ToTable(t => t.HasCheckConstraint("CK_vehicle_handover_values", """ "Kilometers" BETWEEN 0 AND 100000000 AND ("Photo" IS NULL OR octet_length("Photo") BETWEEN 1 AND 5242880) """));
        });
        model.Entity<VehicleReminderDelivery>(e =>
        {
            Operation(e, "vehicle_reminder_deliveries");
            e.HasKey(x => new { x.TenantId, x.VehicleId, x.UserId, x.EventKey });
            e.Property(x => x.UserId).HasMaxLength(256);
            e.Property(x => x.EventKey).HasMaxLength(80);
        });
    }

    private void Operation<T>(EntityTypeBuilder<T> entity, string table) where T : class, ITenantEntity
    {
        VehicleOwned(entity, table);
        entity.HasOne<Vehicle>().WithMany().HasForeignKey("TenantId", "VehicleId").OnDelete(DeleteBehavior.Restrict);
    }
}
