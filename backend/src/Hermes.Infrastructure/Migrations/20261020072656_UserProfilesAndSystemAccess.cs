using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class UserProfilesAndSystemAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "PhoneNumber",
                table: "identity_users",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PasswordChangeRequestedAt",
                table: "identity_users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PasswordChangeRequired",
                table: "identity_users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PasswordChangedAt",
                table: "identity_users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "ProfileVersion",
                table: "identity_users",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.CreateTable(
                name: "system_audit_events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    TargetSubject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: true),
                    Action = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Details = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_system_audit_events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "system_permission_grants",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    Code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_system_permission_grants", x => new { x.UserId, x.Code });
                    table.ForeignKey(
                        name: "FK_system_permission_grants_identity_users_UserId",
                        column: x => x.UserId,
                        principalTable: "identity_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_system_audit_events_CreatedAt_Id",
                table: "system_audit_events",
                columns: new[] { "CreatedAt", "Id" });
            // The runtime role can append audit records, but cannot rewrite or remove history.
            migrationBuilder.Sql("""
                CREATE FUNCTION prevent_system_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'System audit events are append-only' USING ERRCODE = '55000';
                END $$;
                CREATE TRIGGER system_audit_append_only BEFORE UPDATE OR DELETE ON system_audit_events
                    FOR EACH ROW EXECUTE FUNCTION prevent_system_audit_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "system_audit_events");
            migrationBuilder.Sql("DROP FUNCTION prevent_system_audit_mutation();");

            migrationBuilder.DropTable(
                name: "system_permission_grants");

            migrationBuilder.DropColumn(
                name: "PasswordChangeRequestedAt",
                table: "identity_users");

            migrationBuilder.DropColumn(
                name: "PasswordChangeRequired",
                table: "identity_users");

            migrationBuilder.DropColumn(
                name: "PasswordChangedAt",
                table: "identity_users");

            migrationBuilder.DropColumn(
                name: "ProfileVersion",
                table: "identity_users");

            migrationBuilder.AlterColumn<string>(
                name: "PhoneNumber",
                table: "identity_users",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40,
                oldNullable: true);
        }
    }
}
