using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TenantPermissions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DisabledAt",
                table: "tenant_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "tenant_memberships",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "JoinedAt",
                table: "tenant_memberships",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "Version",
                table: "tenant_memberships",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.CreateTable(
                name: "access_audit_events",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Action = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    TargetSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Details = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_access_audit_events", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_access_audit_events_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "permission_definitions",
                columns: table => new
                {
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_permission_definitions", x => x.Code);
                });

            migrationBuilder.CreateTable(
                name: "tenant_invitations",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    NormalizedEmail = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    InvitedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AcceptedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_invitations", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_tenant_invitations_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "tenant_membership_permissions",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_membership_permissions", x => new { x.TenantId, x.UserSubject, x.Code });
                    table.ForeignKey(
                        name: "FK_tenant_membership_permissions_permission_definitions_Code",
                        column: x => x.Code,
                        principalTable: "permission_definitions",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tenant_membership_permissions_tenant_memberships_TenantId_U~",
                        columns: x => new { x.TenantId, x.UserSubject },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tenant_invitation_permissions",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvitationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_invitation_permissions", x => new { x.TenantId, x.InvitationId, x.Code });
                    table.ForeignKey(
                        name: "FK_tenant_invitation_permissions_permission_definitions_Code",
                        column: x => x.Code,
                        principalTable: "permission_definitions",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tenant_invitation_permissions_tenant_invitations_TenantId_I~",
                        columns: x => new { x.TenantId, x.InvitationId },
                        principalTable: "tenant_invitations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "permission_definitions",
                columns: new[] { "Code", "Name" },
                values: new object[,]
                {
                    { "audit.read", "Jogosultsági eseménynapló megtekintése" },
                    { "members.invite", "Meghívások kezelése" },
                    { "members.read", "Céges felhasználók megtekintése" },
                    { "members.update", "Céges hozzáférések felfüggesztése és visszaállítása" },
                    { "permissions.manage", "Céges jogosultságok kiosztása" },
                    { "vehicles.create", "Jármű felvétele" },
                    { "vehicles.read", "Járművek megtekintése" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_access_audit_events_TenantId_CreatedAt_Id",
                table: "access_audit_events",
                columns: new[] { "TenantId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_tenant_invitation_permissions_Code",
                table: "tenant_invitation_permissions",
                column: "Code");

            migrationBuilder.CreateIndex(
                name: "IX_tenant_invitations_TenantId_NormalizedEmail",
                table: "tenant_invitations",
                columns: new[] { "TenantId", "NormalizedEmail" },
                unique: true,
                filter: "\"AcceptedAt\" IS NULL AND \"RevokedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_tenant_membership_permissions_Code",
                table: "tenant_membership_permissions",
                column: "Code");

            // Translate existing memberships before removing the legacy field; accounts and fleet data stay intact.
            migrationBuilder.Sql("""
                INSERT INTO tenant_membership_permissions ("TenantId", "UserSubject", "Code")
                SELECT m."TenantId", m."UserSubject", p."Code"
                FROM tenant_memberships m CROSS JOIN permission_definitions p
                WHERE m."Role" = 'Owner'
                   OR (m."Role" = 'FleetManager' AND p."Code" IN ('vehicles.read', 'vehicles.create'))
                   OR (m."Role" = 'Viewer' AND p."Code" = 'vehicles.read');

                INSERT INTO access_audit_events ("TenantId", "Id", "ActorSubject", "Action", "TargetSubject", "Details", "CreatedAt")
                SELECT m."TenantId", gen_random_uuid(), 'system:migration', 'permissions.migrated', m."UserSubject",
                    jsonb_build_object('legacyRole', m."Role", 'permissions', COALESCE((
                        SELECT jsonb_agg(p."Code" ORDER BY p."Code") FROM tenant_membership_permissions p
                        WHERE p."TenantId" = m."TenantId" AND p."UserSubject" = m."UserSubject"), '[]'::jsonb)), now()
                FROM tenant_memberships m;
                """);
            foreach (var table in new[] { "tenant_membership_permissions", "tenant_invitations", "tenant_invitation_permissions", "access_audit_events" })
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY tenant_isolation ON {table}
                        USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                        WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                    """);
            migrationBuilder.DropColumn(name: "Role", table: "tenant_memberships");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("Granular permissions cannot be downgraded to fixed roles without data loss. Restore a database backup to roll back this migration.");
    }
}
