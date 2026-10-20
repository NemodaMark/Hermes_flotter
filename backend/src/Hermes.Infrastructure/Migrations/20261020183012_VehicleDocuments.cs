using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class VehicleDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vehicle_documents",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaseId = table.Column<Guid>(type: "uuid", nullable: true),
                    ServiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    FileName = table.Column<string>(type: "character varying(180)", maxLength: 180, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ByteLength = table.Column<int>(type: "integer", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UploadedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UploadedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    IsWithdrawn = table.Column<bool>(type: "boolean", nullable: false),
                    StatusReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    StatusChangedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    StatusChangedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_documents", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_vehicle_document_parent", "(\"LeaseId\" IS NOT NULL) <> (\"ServiceId\" IS NOT NULL)");
                    table.CheckConstraint("CK_vehicle_document_size", "\"ByteLength\" BETWEEN 1 AND 10485760");
                    table.ForeignKey(
                        name: "FK_vehicle_documents_vehicle_leases_TenantId_LeaseId",
                        columns: x => new { x.TenantId, x.LeaseId },
                        principalTable: "vehicle_leases",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vehicle_documents_vehicle_services_TenantId_ServiceId",
                        columns: x => new { x.TenantId, x.ServiceId },
                        principalTable: "vehicle_services",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_document_contents",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Bytes = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_document_contents", x => new { x.TenantId, x.DocumentId });
                    table.CheckConstraint("CK_vehicle_document_content_size", "octet_length(\"Bytes\") BETWEEN 1 AND 10485760");
                    table.ForeignKey(
                        name: "FK_vehicle_document_contents_vehicle_documents_TenantId_Docume~",
                        columns: x => new { x.TenantId, x.DocumentId },
                        principalTable: "vehicle_documents",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_documents_TenantId_LeaseId_UploadedAt_Id",
                table: "vehicle_documents",
                columns: new[] { "TenantId", "LeaseId", "UploadedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_documents_TenantId_ServiceId_UploadedAt_Id",
                table: "vehicle_documents",
                columns: new[] { "TenantId", "ServiceId", "UploadedAt", "Id" });
            DocumentSql.Apply(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Document files and their history must be preserved. Restore a backup and its matching application version instead.");
        }
    }
}
