using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class VehicleManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "fleet_partners",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SearchText = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    IsLessor = table.Column<bool>(type: "boolean", nullable: false),
                    IsService = table.Column<bool>(type: "boolean", nullable: false),
                    CountryCode = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    PostalCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    City = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    AddressLine1 = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AddressLine2 = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    Phone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Website = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    ContactsJson = table.Column<string>(type: "jsonb", nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    StatusReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_fleet_partners", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_fleet_partners_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_registration_history",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Registration = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CountryCode = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    RecordedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_registration_history", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_vehicle_registration_history_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_leases",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContractNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PaymentAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    BillingFrequency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AnnualKmLimit = table.Column<long>(type: "bigint", nullable: true),
                    TotalKmLimit = table.Column<long>(type: "bigint", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DocumentUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_leases", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_vehicle_leases_fleet_partners_TenantId_PartnerId",
                        columns: x => new { x.TenantId, x.PartnerId },
                        principalTable: "fleet_partners",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vehicle_leases_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_profiles",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    RegistrationCountry = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    Vin = table.Column<string>(type: "character varying(17)", maxLength: 17, nullable: true),
                    FleetNumber = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    Category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: true),
                    FirstRegistration = table.Column<DateOnly>(type: "date", nullable: true),
                    Color = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    FuelType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PowerKw = table.Column<decimal>(type: "numeric(12,3)", precision: 12, scale: 3, nullable: true),
                    EngineCapacityCc = table.Column<int>(type: "integer", nullable: true),
                    Transmission = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Seats = table.Column<int>(type: "integer", nullable: true),
                    GrossWeightKg = table.Column<int>(type: "integer", nullable: true),
                    PayloadKg = table.Column<int>(type: "integer", nullable: true),
                    CargoVolumeM3 = table.Column<decimal>(type: "numeric(12,3)", precision: 12, scale: 3, nullable: true),
                    BatteryKwh = table.Column<decimal>(type: "numeric(12,3)", precision: 12, scale: 3, nullable: true),
                    Ownership = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FleetEntryDate = table.Column<DateOnly>(type: "date", nullable: true),
                    FleetExitDate = table.Column<DateOnly>(type: "date", nullable: true),
                    InspectionDueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    InsuranceDueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    NextServiceDate = table.Column<DateOnly>(type: "date", nullable: true),
                    NextServiceKm = table.Column<long>(type: "bigint", nullable: true),
                    PreferredServicePartnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    StatusReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_profiles", x => new { x.TenantId, x.VehicleId });
                    table.ForeignKey(
                        name: "FK_vehicle_profiles_fleet_partners_TenantId_PreferredServicePa~",
                        columns: x => new { x.TenantId, x.PreferredServicePartnerId },
                        principalTable: "fleet_partners",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vehicle_profiles_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_services",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    PerformedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Kilometers = table.Column<long>(type: "bigint", nullable: true),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    WorkOrderNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Cost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    NextServiceDate = table.Column<DateOnly>(type: "date", nullable: true),
                    NextServiceKm = table.Column<long>(type: "bigint", nullable: true),
                    DocumentUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Notes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    IsVoided = table.Column<bool>(type: "boolean", nullable: false),
                    VoidReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_services", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_vehicle_services_fleet_partners_TenantId_PartnerId",
                        columns: x => new { x.TenantId, x.PartnerId },
                        principalTable: "fleet_partners",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vehicle_services_vehicles_TenantId_VehicleId",
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
                    { "partners.archive", "Partner archiválása és visszaállítása" },
                    { "partners.create", "Partner felvétele" },
                    { "partners.read", "Partnerek és kapcsolattartók megtekintése" },
                    { "partners.update", "Partneradatok szerkesztése" },
                    { "vehicles.archive", "Jármű archiválása és visszaállítása" },
                    { "vehicles.leasing.manage", "Jármű lízingszerződéseinek kezelése" },
                    { "vehicles.leasing.read", "Jármű lízingszerződéseinek megtekintése" },
                    { "vehicles.service.manage", "Jármű szervizbejegyzéseinek kezelése" },
                    { "vehicles.service.read", "Jármű szervizelőzményeinek megtekintése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_fleet_partners_TenantId_Name_Id",
                table: "fleet_partners",
                columns: new[] { "TenantId", "Name", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_leases_TenantId_PartnerId",
                table: "vehicle_leases",
                columns: new[] { "TenantId", "PartnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_leases_TenantId_VehicleId_StartDate_Id",
                table: "vehicle_leases",
                columns: new[] { "TenantId", "VehicleId", "StartDate", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_profiles_TenantId_FleetNumber",
                table: "vehicle_profiles",
                columns: new[] { "TenantId", "FleetNumber" },
                unique: true,
                filter: "\"FleetNumber\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_profiles_TenantId_PreferredServicePartnerId",
                table: "vehicle_profiles",
                columns: new[] { "TenantId", "PreferredServicePartnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_profiles_TenantId_Vin",
                table: "vehicle_profiles",
                columns: new[] { "TenantId", "Vin" },
                unique: true,
                filter: "\"Vin\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_registration_history_TenantId_Registration",
                table: "vehicle_registration_history",
                columns: new[] { "TenantId", "Registration" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_registration_history_TenantId_VehicleId_RecordedAt_~",
                table: "vehicle_registration_history",
                columns: new[] { "TenantId", "VehicleId", "RecordedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_services_TenantId_PartnerId",
                table: "vehicle_services",
                columns: new[] { "TenantId", "PartnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_services_TenantId_VehicleId_PerformedOn_Id",
                table: "vehicle_services",
                columns: new[] { "TenantId", "VehicleId", "PerformedOn", "Id" });
            VehicleManagementSql.Apply(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Vehicle, partner and contract history must be preserved. Restore a backup and its matching application version instead.");
        }
    }
}
