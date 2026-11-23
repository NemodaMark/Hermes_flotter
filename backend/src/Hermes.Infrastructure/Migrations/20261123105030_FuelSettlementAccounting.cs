using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FuelSettlementAccounting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "fuel_settlement_policies",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    Rules = table.Column<string>(type: "jsonb", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fuel_settlement_policies", x => new { x.TenantId, x.Month });
                    table.CheckConstraint("CK_settlement_policy_month", "extract(day from \"Month\") = 1");
                });

            migrationBuilder.CreateTable(
                name: "fuel_settlements",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    Data = table.Column<string>(type: "jsonb", nullable: false),
                    Calculation = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ApprovedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fuel_settlements", x => new { x.TenantId, x.UserId, x.Month });
                    table.CheckConstraint("CK_settlement_state", "extract(day from \"Month\") = 1 AND \"Status\" IN ('Draft','Submitted','Approved') AND (\"Status\" = 'Approved') = (\"ApprovedAt\" IS NOT NULL AND \"ApprovedBy\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_fuel_settlements_tenant_memberships_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "fuel_settlement_history",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Actor = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fuel_settlement_history", x => new { x.TenantId, x.UserId, x.Month, x.Version });
                    table.ForeignKey(
                        name: "FK_fuel_settlement_history_fuel_settlements_TenantId_UserId_Mo~",
                        columns: x => new { x.TenantId, x.UserId, x.Month },
                        principalTable: "fuel_settlements",
                        principalColumns: new[] { "TenantId", "UserId", "Month" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "fuel_settlement_vehicles",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceWorkbook = table.Column<byte[]>(type: "bytea", nullable: true),
                    SourceMetadata = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fuel_settlement_vehicles", x => new { x.TenantId, x.UserId, x.Month, x.VehicleId });
                    table.ForeignKey(
                        name: "FK_fuel_settlement_vehicles_fuel_settlements_TenantId_UserId_M~",
                        columns: x => new { x.TenantId, x.UserId, x.Month },
                        principalTable: "fuel_settlements",
                        principalColumns: new[] { "TenantId", "UserId", "Month" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_fuel_settlement_vehicles_vehicles_TenantId_VehicleId",
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
                    { "settlements.configure", "Üzemanyag-elszámolási szabályok beállítása" },
                    { "vehicles.settlements.approve", "Üzemanyag-elszámolások jóváhagyása" },
                    { "vehicles.settlements.manage", "Üzemanyag-elszámolások kezelése és Excel-import" },
                    { "vehicles.settlements.read", "Saját üzemanyag-elszámolás megtekintése" },
                    { "vehicles.settlements.record", "Saját üzemanyag-elszámolás rögzítése és beküldése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_fuel_settlement_vehicles_TenantId_VehicleId",
                table: "fuel_settlement_vehicles",
                columns: new[] { "TenantId", "VehicleId" });
            foreach (var table in new[] { "fuel_settlement_policies", "fuel_settlements", "fuel_settlement_vehicles", "fuel_settlement_history" })
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY tenant_isolation ON {table}
                        USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                        WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                    """);
            migrationBuilder.Sql("""
                CREATE FUNCTION protect_settlement_history() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Settlement history is append-only' USING ERRCODE = '55000'; END $$;
                CREATE TRIGGER settlement_history_guard BEFORE UPDATE OR DELETE ON fuel_settlement_history FOR EACH ROW EXECUTE FUNCTION protect_settlement_history();
                CREATE FUNCTION protect_settlement_origin() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Settlement history must be preserved' USING ERRCODE = '55000'; END IF;
                    IF ROW(NEW."TenantId",NEW."UserId",NEW."Month") IS DISTINCT FROM ROW(OLD."TenantId",OLD."UserId",OLD."Month") OR NEW."Version" <> OLD."Version" + 1 THEN
                        RAISE EXCEPTION 'Settlement identity is immutable and version must advance' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER settlement_origin_guard BEFORE UPDATE OR DELETE ON fuel_settlements FOR EACH ROW EXECUTE FUNCTION protect_settlement_origin();
                CREATE FUNCTION protect_settlement_source() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        IF OLD."SourceWorkbook" IS NOT NULL THEN RAISE EXCEPTION 'Imported source must be preserved' USING ERRCODE = '55000'; END IF;
                        RETURN OLD;
                    END IF;
                    IF ROW(NEW."TenantId",NEW."UserId",NEW."Month",NEW."VehicleId",NEW."SourceWorkbook",NEW."SourceMetadata")
                        IS DISTINCT FROM ROW(OLD."TenantId",OLD."UserId",OLD."Month",OLD."VehicleId",OLD."SourceWorkbook",OLD."SourceMetadata") THEN
                        RAISE EXCEPTION 'Settlement source is immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER settlement_source_guard BEFORE UPDATE OR DELETE ON fuel_settlement_vehicles FOR EACH ROW EXECUTE FUNCTION protect_settlement_source();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Financial history must be retained. Restore a verified backup to roll back this release.");
        }
    }
}
