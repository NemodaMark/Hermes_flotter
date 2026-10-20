using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class GroupSiteScopes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "RestrictSites",
                table: "company_access_scopes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "company_access_site_scopes",
                columns: table => new
                {
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    SiteId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_company_access_site_scopes", x => new { x.GroupId, x.TenantId, x.SiteId });
                    table.ForeignKey(
                        name: "FK_company_access_site_scopes_company_access_scopes_GroupId_Te~",
                        columns: x => new { x.GroupId, x.TenantId },
                        principalTable: "company_access_scopes",
                        principalColumns: new[] { "GroupId", "TenantId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_company_access_site_scopes_company_sites_TenantId_SiteId",
                        columns: x => new { x.TenantId, x.SiteId },
                        principalTable: "company_sites",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_company_access_site_scopes_TenantId_SiteId",
                table: "company_access_site_scopes",
                columns: new[] { "TenantId", "SiteId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Dropping site scopes would broaden access. Restore a backup and its matching application version instead.");
        }
    }
}
