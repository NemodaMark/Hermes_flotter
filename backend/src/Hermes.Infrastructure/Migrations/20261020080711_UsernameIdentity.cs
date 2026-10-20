using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class UsernameIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "user_identity_history",
                columns: table => new
                {
                    PreviousId = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: true),
                    ReservedName = table.Column<string>(type: "text", nullable: false, computedColumnSql: "lower(\"PreviousId\")", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_identity_history", x => x.PreviousId);
                    table.ForeignKey(
                        name: "FK_user_identity_history_identity_users_UserId",
                        column: x => x.UserId,
                        principalTable: "identity_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.Sql(UsernameIdentitySql.Convert);

            migrationBuilder.AddCheckConstraint(
                name: "CK_identity_users_username_key",
                table: "identity_users",
                sql: "\"Id\" ~ '^[a-z0-9][a-z0-9._-]{2,63}$' AND \"UserName\" IS NOT NULL AND \"UserName\" = \"Id\" AND \"NormalizedUserName\" IS NOT NULL AND \"NormalizedUserName\" = upper(\"Id\")");

            migrationBuilder.CreateIndex(
                name: "IX_user_identity_history_ReservedName",
                table: "user_identity_history",
                column: "ReservedName");

            migrationBuilder.CreateIndex(
                name: "IX_user_identity_history_UserId",
                table: "user_identity_history",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Username identity conversion requires a database backup and the matching application version to restore.");
        }
    }
}
