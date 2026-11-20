using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MonthlyMileageAndFuelCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsFullTank",
                table: "vehicle_fuel_entries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ReceiptNumber",
                table: "vehicle_fuel_entries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "RecordedAt",
                table: "vehicle_fuel_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "UpdatedAt",
                table: "vehicle_fuel_entries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UpdatedBy",
                table: "vehicle_fuel_entries",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "vehicle_fuel_entries",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.CreateTable(
                name: "mileage_accounts",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    MonthlyLimitKm = table.Column<long>(type: "bigint", nullable: true),
                    FirstMonth = table.Column<DateOnly>(type: "date", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mileage_accounts", x => new { x.TenantId, x.UserId });
                    table.CheckConstraint("CK_mileage_account", "\"Mode\" IN ('Entries','Monthly') AND (\"MonthlyLimitKm\" IS NULL OR \"MonthlyLimitKm\" BETWEEN 0 AND 100000000) AND extract(day from \"FirstMonth\") = 1");
                    table.ForeignKey(
                        name: "FK_mileage_accounts_tenant_memberships_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "mileage_months",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    Mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    TotalKm = table.Column<long>(type: "bigint", nullable: false),
                    PrivateKm = table.Column<long>(type: "bigint", nullable: false),
                    LimitKm = table.Column<long>(type: "bigint", nullable: true),
                    LimitCaptured = table.Column<bool>(type: "boolean", nullable: false),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mileage_months", x => new { x.TenantId, x.UserId, x.Month });
                    table.CheckConstraint("CK_mileage_month", "\"Mode\" IN ('Entries','Monthly') AND \"TotalKm\" BETWEEN 0 AND 100000000 AND \"PrivateKm\" BETWEEN 0 AND \"TotalKm\" AND extract(day from \"Month\") = 1");
                    table.ForeignKey(
                        name: "FK_mileage_months_mileage_accounts_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalTable: "mileage_accounts",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "mileage_entries",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartKilometers = table.Column<long>(type: "bigint", nullable: true),
                    EndKilometers = table.Column<long>(type: "bigint", nullable: true),
                    OccurredOn = table.Column<DateOnly>(type: "date", nullable: false),
                    TotalKm = table.Column<long>(type: "bigint", nullable: false),
                    PrivateKm = table.Column<long>(type: "bigint", nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L),
                    VoidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RecordedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mileage_entries", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_mileage_entry", "\"TotalKm\" BETWEEN 0 AND 100000000 AND \"PrivateKm\" BETWEEN 0 AND \"TotalKm\" AND date_trunc('month', \"OccurredOn\"::timestamp)::date = \"Month\"");
                    table.CheckConstraint("CK_mileage_interval", "(\"StartKilometers\" IS NULL AND \"EndKilometers\" IS NULL) OR (\"StartKilometers\" IS NOT NULL AND \"EndKilometers\" IS NOT NULL AND \"StartKilometers\" >= 0 AND \"EndKilometers\" - \"StartKilometers\" = \"TotalKm\" AND \"EndKilometers\" <= 100000000)");
                    table.ForeignKey(
                        name: "FK_mileage_entries_mileage_months_TenantId_UserId_Month",
                        columns: x => new { x.TenantId, x.UserId, x.Month },
                        principalTable: "mileage_months",
                        principalColumns: new[] { "TenantId", "UserId", "Month" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_mileage_entries_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "permission_definitions",
                columns: new[] { "Code", "Name" },
                values: new object[,]
                {
                    { "mileage.manage", "Céges km-keretek és havi elszámolások kezelése" },
                    { "mileage.record", "Saját havi km-elszámolás és magánhasználat rögzítése" }
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_vehicle_fuel_version",
                table: "vehicle_fuel_entries",
                sql: "\"Version\" > 0");

            migrationBuilder.CreateIndex(
                name: "IX_mileage_entries_TenantId_Source_SourceId",
                table: "mileage_entries",
                columns: new[] { "TenantId", "Source", "SourceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_mileage_entries_TenantId_UserId_Month",
                table: "mileage_entries",
                columns: new[] { "TenantId", "UserId", "Month" });

            migrationBuilder.CreateIndex(
                name: "IX_mileage_entries_TenantId_VehicleId_StartKilometers",
                table: "mileage_entries",
                columns: new[] { "TenantId", "VehicleId", "StartKilometers" });
            foreach (var table in new[] { "mileage_accounts", "mileage_months", "mileage_entries" })
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY tenant_isolation ON {table}
                        USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                        WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                    """);
            migrationBuilder.Sql("""
                CREATE FUNCTION protect_fuel_origin() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Fuel history cannot be deleted' USING ERRCODE = '55000'; END IF;
                    IF ROW(NEW."TenantId", NEW."Id", NEW."VehicleId", NEW."RecordedBy", NEW."RecordedAt", NEW."Receipt")
                        IS DISTINCT FROM ROW(OLD."TenantId", OLD."Id", OLD."VehicleId", OLD."RecordedBy", OLD."RecordedAt", OLD."Receipt")
                        OR NEW."Version" <> OLD."Version" + 1 THEN
                        RAISE EXCEPTION 'Fuel origin and receipt are immutable; version must advance' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER fuel_origin_guard BEFORE UPDATE OR DELETE ON vehicle_fuel_entries FOR EACH ROW EXECUTE FUNCTION protect_fuel_origin();
                CREATE FUNCTION protect_mileage_origin() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Mileage history cannot be deleted' USING ERRCODE = '55000'; END IF;
                    IF ROW(NEW."TenantId", NEW."Id", NEW."UserId", NEW."Month", NEW."VehicleId", NEW."Source", NEW."SourceId", NEW."EndKilometers", NEW."RecordedBy", NEW."RecordedAt")
                        IS DISTINCT FROM ROW(OLD."TenantId", OLD."Id", OLD."UserId", OLD."Month", OLD."VehicleId", OLD."Source", OLD."SourceId", OLD."EndKilometers", OLD."RecordedBy", OLD."RecordedAt")
                        OR NEW."Version" <> OLD."Version" + 1 THEN
                        RAISE EXCEPTION 'Mileage source is immutable; version must advance' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER mileage_origin_guard BEFORE UPDATE OR DELETE ON mileage_entries FOR EACH ROW EXECUTE FUNCTION protect_mileage_origin();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Mileage and fuel history must be retained. Restore a tested backup to roll back this release.");
        }
    }
}
