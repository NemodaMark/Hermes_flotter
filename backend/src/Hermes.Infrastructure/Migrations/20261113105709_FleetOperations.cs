using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FleetOperations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vehicle_booking_settings",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_booking_settings", x => new { x.TenantId, x.VehicleId });
                    table.ForeignKey(
                        name: "FK_vehicle_booking_settings_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_bookings",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    StartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    EndsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    CancelledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CancelledBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_bookings", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_vehicle_booking_duration", " \"EndsOn\" - \"StartsOn\" BETWEEN 0 AND 6 ");
                    table.ForeignKey(
                        name: "FK_vehicle_bookings_tenant_memberships_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vehicle_bookings_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_fuel_entries",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    FueledOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Kilometers = table.Column<long>(type: "bigint", nullable: false),
                    Liters = table.Column<decimal>(type: "numeric(9,3)", precision: 9, scale: 3, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(14,2)", precision: 14, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    RecordedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Receipt = table.Column<byte[]>(type: "bytea", nullable: true),
                    VoidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_fuel_entries", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_vehicle_fuel_values", " \"Kilometers\" BETWEEN 0 AND 100000000 AND \"Liters\" > 0 AND \"Amount\" >= 0 AND (\"Receipt\" IS NULL OR octet_length(\"Receipt\") BETWEEN 1 AND 5242880) ");
                    table.ForeignKey(
                        name: "FK_vehicle_fuel_entries_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_handovers",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    PreviousUserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    NextUserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    RecordedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Kilometers = table.Column<long>(type: "bigint", nullable: false),
                    Condition = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Photo = table.Column<byte[]>(type: "bytea", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_handovers", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_vehicle_handover_values", " \"Kilometers\" BETWEEN 0 AND 100000000 AND (\"Photo\" IS NULL OR octet_length(\"Photo\") BETWEEN 1 AND 5242880) ");
                    table.ForeignKey(
                        name: "FK_vehicle_handovers_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_reminder_deliveries",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    EventKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RetryAfter = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Delivered = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_reminder_deliveries", x => new { x.TenantId, x.VehicleId, x.UserId, x.EventKey });
                    table.ForeignKey(
                        name: "FK_vehicle_reminder_deliveries_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_service_appointments",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_service_appointments", x => new { x.TenantId, x.VehicleId });
                    table.ForeignKey(
                        name: "FK_vehicle_service_appointments_vehicles_TenantId_VehicleId",
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
                    { "vehicles.bookings.create", "Jármű foglalása és saját foglalás lemondása" },
                    { "vehicles.bookings.manage", "Járműfoglalási beállítás és foglalások kezelése" },
                    { "vehicles.bookings.read", "Járműfoglalások megtekintése" },
                    { "vehicles.fuel.manage", "Tankolások rögzítése és érvénytelenítése" },
                    { "vehicles.fuel.read", "Tankolások és elszámolások megtekintése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_bookings_TenantId_UserId",
                table: "vehicle_bookings",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_bookings_TenantId_VehicleId_StartsOn",
                table: "vehicle_bookings",
                columns: new[] { "TenantId", "VehicleId", "StartsOn" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_fuel_entries_TenantId_VehicleId_FueledOn",
                table: "vehicle_fuel_entries",
                columns: new[] { "TenantId", "VehicleId", "FueledOn" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_handovers_TenantId_VehicleId_RecordedAt",
                table: "vehicle_handovers",
                columns: new[] { "TenantId", "VehicleId", "RecordedAt" });
            foreach (var table in new[] { "vehicle_booking_settings", "vehicle_bookings", "vehicle_fuel_entries",
                "vehicle_handovers", "vehicle_reminder_deliveries", "vehicle_service_appointments" })
            {
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY tenant_isolation ON {table}
                        USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                        WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                    """);
            }
            migrationBuilder.Sql("""
                CREATE EXTENSION IF NOT EXISTS btree_gist;
                ALTER TABLE vehicle_bookings ADD CONSTRAINT vehicle_bookings_no_overlap
                    EXCLUDE USING gist ("TenantId" WITH =, "VehicleId" WITH =,
                        daterange("StartsOn", "EndsOn", '[]') WITH &&)
                    WHERE ("CancelledAt" IS NULL);
                CREATE FUNCTION protect_vehicle_handover() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Handover history is append-only' USING ERRCODE = '55000'; END $$;
                CREATE TRIGGER vehicle_handover_immutable BEFORE UPDATE OR DELETE ON vehicle_handovers
                    FOR EACH ROW EXECUTE FUNCTION protect_vehicle_handover();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Restore the matching database backup to preserve fleet operation history.");
        }
    }
}
