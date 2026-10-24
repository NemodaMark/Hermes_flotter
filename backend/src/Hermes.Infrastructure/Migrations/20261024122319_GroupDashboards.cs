using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class GroupDashboards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DashboardMode",
                table: "company_access_groups",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Overview");

            migrationBuilder.AddColumn<int>(
                name: "DashboardPriority",
                table: "company_access_groups",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "group_dashboard_mode",
                table: "company_access_groups",
                sql: "\"DashboardMode\" IN ('Overview','Vehicle')");

            migrationBuilder.AddCheckConstraint(
                name: "group_dashboard_priority",
                table: "company_access_groups",
                sql: "\"DashboardPriority\" BETWEEN 0 AND 1000");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "group_dashboard_mode",
                table: "company_access_groups");

            migrationBuilder.DropCheckConstraint(
                name: "group_dashboard_priority",
                table: "company_access_groups");

            migrationBuilder.DropColumn(
                name: "DashboardMode",
                table: "company_access_groups");

            migrationBuilder.DropColumn(
                name: "DashboardPriority",
                table: "company_access_groups");
        }
    }
}
