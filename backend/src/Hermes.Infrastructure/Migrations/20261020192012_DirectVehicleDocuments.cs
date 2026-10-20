using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DirectVehicleDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_vehicle_document_parent",
                table: "vehicle_documents");

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "vehicle_documents",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "VehicleId",
                table: "vehicle_documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.InsertData(
                table: "permission_definitions",
                columns: new[] { "Code", "Name" },
                values: new object[,]
                {
                    { "vehicles.documents.manage", "Járműokmányok kezelése" },
                    { "vehicles.documents.read", "Járműokmányok megtekintése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_documents_TenantId_VehicleId_UploadedAt_Id",
                table: "vehicle_documents",
                columns: new[] { "TenantId", "VehicleId", "UploadedAt", "Id" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_vehicle_document_category",
                table: "vehicle_documents",
                sql: "(\"VehicleId\" IS NULL AND \"Category\" IS NULL) OR (\"VehicleId\" IS NOT NULL AND \"Category\" IS NOT NULL AND \"Category\" IN ('Registration','Insurance','Inspection'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_vehicle_document_parent",
                table: "vehicle_documents",
                sql: "((\"LeaseId\" IS NOT NULL)::int + (\"ServiceId\" IS NOT NULL)::int + (\"VehicleId\" IS NOT NULL)::int) = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_vehicle_documents_vehicles_TenantId_VehicleId",
                table: "vehicle_documents",
                columns: new[] { "TenantId", "VehicleId" },
                principalTable: "vehicles",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION protect_vehicle_document_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Withdraw documents instead of deleting them' USING ERRCODE = '55000'; END IF;
                  IF ROW(OLD."TenantId",OLD."Id",OLD."LeaseId",OLD."ServiceId",OLD."VehicleId",OLD."Category",OLD."FileName",OLD."ContentType",OLD."ByteLength",OLD."Sha256",OLD."UploadedBy",OLD."UploadedAt")
                    IS DISTINCT FROM ROW(NEW."TenantId",NEW."Id",NEW."LeaseId",NEW."ServiceId",NEW."VehicleId",NEW."Category",NEW."FileName",NEW."ContentType",NEW."ByteLength",NEW."Sha256",NEW."UploadedBy",NEW."UploadedAt")
                    THEN RAISE EXCEPTION 'Original document metadata is immutable' USING ERRCODE = '55000'; END IF;
                  RETURN NEW;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Vehicle documents and their history must be preserved. Restore a backup and its matching application version instead.");
        }
    }
}
