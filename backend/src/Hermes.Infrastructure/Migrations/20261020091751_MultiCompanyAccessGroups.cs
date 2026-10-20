using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class MultiCompanyAccessGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HasDirectAccess",
                table: "tenant_memberships",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "company_access_groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    AllPermissions = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_access_groups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_company_access_groups_identity_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalTable: "identity_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "company_access_permissions",
                columns: table => new
                {
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_access_permissions", x => new { x.GroupId, x.Code });
                    table.ForeignKey(
                        name: "FK_company_access_permissions_company_access_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "company_access_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_company_access_permissions_permission_definitions_Code",
                        column: x => x.Code,
                        principalTable: "permission_definitions",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "company_access_scopes",
                columns: table => new
                {
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_access_scopes", x => new { x.GroupId, x.TenantId });
                    table.ForeignKey(
                        name: "FK_company_access_scopes_company_access_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "company_access_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_company_access_scopes_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "company_access_users",
                columns: table => new
                {
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_access_users", x => new { x.GroupId, x.UserId });
                    table.ForeignKey(
                        name: "FK_company_access_users_company_access_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "company_access_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_company_access_users_identity_users_UserId",
                        column: x => x.UserId,
                        principalTable: "identity_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "company_access_memberships",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_access_memberships", x => new { x.TenantId, x.UserSubject, x.GroupId });
                    table.ForeignKey(
                        name: "FK_company_access_memberships_company_access_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "company_access_groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_company_access_memberships_company_access_scopes_GroupId_Te~",
                        columns: x => new { x.GroupId, x.TenantId },
                        principalTable: "company_access_scopes",
                        principalColumns: new[] { "GroupId", "TenantId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_company_access_memberships_company_access_users_GroupId_Use~",
                        columns: x => new { x.GroupId, x.UserSubject },
                        principalTable: "company_access_users",
                        principalColumns: new[] { "GroupId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_company_access_memberships_tenant_memberships_TenantId_User~",
                        columns: x => new { x.TenantId, x.UserSubject },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_company_access_groups_CreatedBy_NormalizedName",
                table: "company_access_groups",
                columns: new[] { "CreatedBy", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_company_access_memberships_GroupId_TenantId",
                table: "company_access_memberships",
                columns: new[] { "GroupId", "TenantId" });

            migrationBuilder.CreateIndex(
                name: "IX_company_access_memberships_GroupId_UserSubject",
                table: "company_access_memberships",
                columns: new[] { "GroupId", "UserSubject" });

            migrationBuilder.CreateIndex(
                name: "IX_company_access_permissions_Code",
                table: "company_access_permissions",
                column: "Code");

            migrationBuilder.CreateIndex(
                name: "IX_company_access_scopes_TenantId",
                table: "company_access_scopes",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_company_access_users_UserId",
                table: "company_access_users",
                column: "UserId");
            migrationBuilder.Sql("""
                ALTER TABLE company_access_memberships ENABLE ROW LEVEL SECURITY;
                ALTER TABLE company_access_memberships FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON company_access_memberships
                  USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                  WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("Cross-company access provenance cannot be removed without data loss. Restore a database backup to roll back.");
    }
}
