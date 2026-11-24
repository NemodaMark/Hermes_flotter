using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FleetEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "fleet_events",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    StartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Repeat = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Every = table.Column<int>(type: "integer", nullable: false),
                    EndsOn = table.Column<DateOnly>(type: "date", nullable: true),
                    StoppedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fleet_events", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_fleet_event_schedule", "\"StartsOn\" BETWEEN DATE '1900-01-01' AND DATE '2100-12-31' AND \"Version\" > 0 AND\n(\"EndsOn\" IS NULL OR \"EndsOn\" BETWEEN \"StartsOn\" AND DATE '2100-12-31') AND\n((\"Repeat\" = 'Once' AND \"Every\" = 1 AND \"EndsOn\" IS NULL) OR\n (\"Repeat\" IN ('Day','Week','Month','Year') AND \"Every\" BETWEEN 1 AND 999))");
                    table.ForeignKey(
                        name: "FK_fleet_events_vehicles_TenantId_VehicleId",
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
                    { "vehicles.events.manage", "Flottaesemények ütemezése és kezelése" },
                    { "vehicles.events.read", "Flottaesemények megtekintése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_fleet_events_TenantId_StartsOn",
                table: "fleet_events",
                columns: new[] { "TenantId", "StartsOn" });

            migrationBuilder.CreateIndex(
                name: "IX_fleet_events_TenantId_VehicleId",
                table: "fleet_events",
                columns: new[] { "TenantId", "VehicleId" });

            migrationBuilder.Sql("""
                ALTER TABLE fleet_events ENABLE ROW LEVEL SECURITY;
                ALTER TABLE fleet_events FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON fleet_events
                    USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                    WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "fleet_events");

            migrationBuilder.DeleteData(
                table: "permission_definitions",
                keyColumn: "Code",
                keyValue: "vehicles.events.manage");

            migrationBuilder.DeleteData(
                table: "permission_definitions",
                keyColumn: "Code",
                keyValue: "vehicles.events.read");
        }
    }
}
