using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    private void ConfigureOrganizations(ModelBuilder model)
    {
        model.Entity<CompanyProfile>(e =>
        {
            e.ToTable("company_profiles");
            e.HasKey(x => x.TenantId);
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.LegalName).HasMaxLength(200);
            e.Property(x => x.TaxNumber).HasMaxLength(40);
            e.Property(x => x.RegistrationNumber).HasMaxLength(40);
            e.Property(x => x.EuVatNumber).HasMaxLength(40);
            e.Property(x => x.CountryCode).HasMaxLength(2);
            e.Property(x => x.PostalCode).HasMaxLength(20);
            e.Property(x => x.City).HasMaxLength(120);
            e.Property(x => x.AddressLine1).HasMaxLength(200);
            e.Property(x => x.AddressLine2).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Website).HasMaxLength(2048);
            e.Property(x => x.Currency).HasMaxLength(3);
            e.Property(x => x.DistanceUnit).HasMaxLength(2);
            e.Property(x => x.StatusReason).HasMaxLength(500);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.Property(x => x.CreatedBy).HasMaxLength(256);
            e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        model.Entity<CompanyContact>(e =>
        {
            e.ToTable("company_contacts");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Position).HasMaxLength(80);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.StatusReason).HasMaxLength(500);
            e.Property(x => x.CreatedBy).HasMaxLength(256);
            e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        model.Entity<Site>(e =>
        {
            e.ToTable("company_sites");
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<CompanyContact>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.ContactId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Name).HasMaxLength(120);
            e.Property(x => x.Code).HasMaxLength(32);
            e.Property(x => x.NormalizedCode).HasMaxLength(32);
            e.HasIndex(x => new { x.TenantId, x.NormalizedCode }).IsUnique();
            e.Property(x => x.CountryCode).HasMaxLength(2);
            e.Property(x => x.PostalCode).HasMaxLength(20);
            e.Property(x => x.City).HasMaxLength(120);
            e.Property(x => x.AddressLine1).HasMaxLength(200);
            e.Property(x => x.AddressLine2).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.StatusReason).HasMaxLength(500);
            e.Property(x => x.CreatedBy).HasMaxLength(256);
            e.Property(x => x.UpdatedBy).HasMaxLength(256);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
        model.Entity<VehicleSiteAssignment>(e =>
        {
            e.ToTable("vehicle_site_assignments");
            e.HasKey(x => new { x.TenantId, x.VehicleId });
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Site>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.SiteId }).OnDelete(DeleteBehavior.Restrict);
            e.HasQueryFilter(x => x.TenantId == CurrentTenantId);
        });
    }
}
