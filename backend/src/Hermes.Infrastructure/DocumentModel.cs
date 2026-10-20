using Hermes.Domain;
using Microsoft.EntityFrameworkCore;

namespace Hermes.Infrastructure;

public sealed partial class HermesDbContext
{
    private void ConfigureDocuments(ModelBuilder model)
    {
        model.Entity<VehicleDocument>(e =>
        {
            VehicleOwned(e, "vehicle_documents");
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_vehicle_document_parent", "((\"LeaseId\" IS NOT NULL)::int + (\"ServiceId\" IS NOT NULL)::int + (\"VehicleId\" IS NOT NULL)::int) = 1");
                t.HasCheckConstraint("CK_vehicle_document_category", "(\"VehicleId\" IS NULL AND \"Category\" IS NULL) OR (\"VehicleId\" IS NOT NULL AND \"Category\" IS NOT NULL AND \"Category\" IN ('Registration','Insurance','Inspection'))");
                t.HasCheckConstraint("CK_vehicle_document_size", "\"ByteLength\" BETWEEN 1 AND 10485760");
            });
            e.HasKey(x => new { x.TenantId, x.Id });
            e.HasOne<VehicleLease>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.LeaseId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<VehicleService>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.ServiceId }).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Vehicle>().WithMany().HasForeignKey(x => new { x.TenantId, Id = x.VehicleId }).OnDelete(DeleteBehavior.Restrict);
            e.Property(x => x.Category).HasMaxLength(32);
            e.Property(x => x.FileName).HasMaxLength(180);
            e.Property(x => x.ContentType).HasMaxLength(100);
            e.Property(x => x.Sha256).HasMaxLength(64);
            e.Property(x => x.UploadedBy).HasMaxLength(256);
            e.Property(x => x.Version).IsConcurrencyToken();
            e.Property(x => x.StatusReason).HasMaxLength(500);
            e.Property(x => x.StatusChangedBy).HasMaxLength(256);
            e.HasIndex(x => new { x.TenantId, x.LeaseId, x.UploadedAt, x.Id });
            e.HasIndex(x => new { x.TenantId, x.ServiceId, x.UploadedAt, x.Id });
            e.HasIndex(x => new { x.TenantId, x.VehicleId, x.UploadedAt, x.Id });
        });
        model.Entity<VehicleDocumentContent>(e =>
        {
            VehicleOwned(e, "vehicle_document_contents");
            e.ToTable(t => t.HasCheckConstraint("CK_vehicle_document_content_size", "octet_length(\"Bytes\") BETWEEN 1 AND 10485760"));
            e.HasKey(x => new { x.TenantId, x.DocumentId });
            e.HasOne<VehicleDocument>().WithOne().HasForeignKey<VehicleDocumentContent>(x => new { x.TenantId, Id = x.DocumentId }).OnDelete(DeleteBehavior.Restrict);
        });
    }
}
