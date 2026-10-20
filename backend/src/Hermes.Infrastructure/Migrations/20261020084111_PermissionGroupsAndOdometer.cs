using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PermissionGroupsAndOdometer : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "OdometerKm",
                table: "vehicles",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "vehicles",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.CreateTable(
                name: "permission_groups",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    IsAdmin = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_permission_groups", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_group_admin_name", "\"IsAdmin\" = (\"NormalizedName\" = 'ADMIN')");
                    table.ForeignKey(
                        name: "FK_permission_groups_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_odometer_readings",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kilometers = table.Column<long>(type: "bigint", nullable: false),
                    RecordedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_odometer_readings", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_vehicle_odometer_readings_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "permission_group_permissions",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_permission_group_permissions", x => new { x.TenantId, x.GroupId, x.Code });
                    table.ForeignKey(
                        name: "FK_permission_group_permissions_permission_definitions_Code",
                        column: x => x.Code,
                        principalTable: "permission_definitions",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_permission_group_permissions_permission_groups_TenantId_Gro~",
                        columns: x => new { x.TenantId, x.GroupId },
                        principalTable: "permission_groups",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tenant_membership_groups",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_membership_groups", x => new { x.TenantId, x.UserSubject, x.GroupId });
                    table.ForeignKey(
                        name: "FK_tenant_membership_groups_permission_groups_TenantId_GroupId",
                        columns: x => new { x.TenantId, x.GroupId },
                        principalTable: "permission_groups",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tenant_membership_groups_tenant_memberships_TenantId_UserSu~",
                        columns: x => new { x.TenantId, x.UserSubject },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "permission_definitions",
                columns: new[] { "Code", "Name" },
                values: new object[,]
                {
                    { "permission-groups.manage", "Jogosultságcsoportok kezelése" },
                    { "vehicles.odometer.create", "Kilométerállás rögzítése" },
                    { "vehicles.update", "Járműadatok szerkesztése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_permission_group_permissions_Code",
                table: "permission_group_permissions",
                column: "Code");

            migrationBuilder.CreateIndex(
                name: "IX_permission_groups_TenantId_NormalizedName",
                table: "permission_groups",
                columns: new[] { "TenantId", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenant_membership_groups_TenantId_GroupId",
                table: "tenant_membership_groups",
                columns: new[] { "TenantId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_odometer_readings_TenantId_VehicleId_RecordedAt",
                table: "vehicle_odometer_readings",
                columns: new[] { "TenantId", "VehicleId", "RecordedAt" });
            PermissionGroupsSql.Apply(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("Permission groups and odometer history cannot be removed without data loss. Restore a database backup to roll back.");
    }
}
