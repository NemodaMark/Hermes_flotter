using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OptionalFuelCosts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_vehicle_fuel_values",
                table: "vehicle_fuel_entries");

            migrationBuilder.AlterColumn<string>(
                name: "Currency",
                table: "vehicle_fuel_entries",
                type: "character varying(3)",
                maxLength: 3,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(3)",
                oldMaxLength: 3);

            migrationBuilder.AlterColumn<decimal>(
                name: "Amount",
                table: "vehicle_fuel_entries",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: true,
                oldClrType: typeof(decimal),
                oldType: "numeric(14,2)",
                oldPrecision: 14,
                oldScale: 2);

            migrationBuilder.AddCheckConstraint(
                name: "CK_vehicle_fuel_values",
                table: "vehicle_fuel_entries",
                sql: " \"Kilometers\" BETWEEN 0 AND 100000000 AND \"Liters\" > 0 AND (\"Amount\" IS NULL) = (\"Currency\" IS NULL) AND (\"Amount\" IS NULL OR \"Amount\" >= 0) AND (\"Receipt\" IS NULL OR octet_length(\"Receipt\") BETWEEN 1 AND 5242880) ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_vehicle_fuel_values",
                table: "vehicle_fuel_entries");

            migrationBuilder.AlterColumn<string>(
                name: "Currency",
                table: "vehicle_fuel_entries",
                type: "character varying(3)",
                maxLength: 3,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(3)",
                oldMaxLength: 3,
                oldNullable: true);

            migrationBuilder.AlterColumn<decimal>(
                name: "Amount",
                table: "vehicle_fuel_entries",
                type: "numeric(14,2)",
                precision: 14,
                scale: 2,
                nullable: false,
                defaultValue: 0m,
                oldClrType: typeof(decimal),
                oldType: "numeric(14,2)",
                oldPrecision: 14,
                oldScale: 2,
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_vehicle_fuel_values",
                table: "vehicle_fuel_entries",
                sql: " \"Kilometers\" BETWEEN 0 AND 100000000 AND \"Liters\" > 0 AND \"Amount\" >= 0 AND (\"Receipt\" IS NULL OR octet_length(\"Receipt\") BETWEEN 1 AND 5242880) ");
        }
    }
}
