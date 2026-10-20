using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PeopleAndVehicleMedia : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CreatedBy",
                table: "vehicles",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BodyType",
                table: "vehicle_profiles",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "user_avatars",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Bytes = table.Column<byte[]>(type: "bytea", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_avatars", x => x.UserId);
                    table.CheckConstraint("CK_user_avatar_bytes", "octet_length(\"Bytes\") BETWEEN 1 AND 5242880");
                    table.ForeignKey(
                        name: "FK_user_avatars_identity_users_UserId",
                        column: x => x.UserId,
                        principalTable: "identity_users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_model_options",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    MakeKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ModelKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Make = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_model_options", x => new { x.TenantId, x.MakeKey, x.ModelKey });
                    table.ForeignKey(
                        name: "FK_vehicle_model_options_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_photos",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    Slot = table.Column<int>(type: "integer", nullable: false),
                    Bytes = table.Column<byte[]>(type: "bytea", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UploadedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UploadedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_photos", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_vehicle_photo_bytes", "octet_length(\"Bytes\") BETWEEN 1 AND 5242880");
                    table.CheckConstraint("CK_vehicle_photo_slot", "\"Slot\" BETWEEN 1 AND 5");
                    table.ForeignKey(
                        name: "FK_vehicle_photos_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "vehicle_user_assignments",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    AssignedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    AssignedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReleasedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReleasedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vehicle_user_assignments", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_vehicle_assignment_dates", "\"ReleasedAt\" IS NULL OR \"ReleasedAt\" >= \"AssignedAt\"");
                    table.ForeignKey(
                        name: "FK_vehicle_user_assignments_tenant_memberships_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalTable: "tenant_memberships",
                        principalColumns: new[] { "TenantId", "UserSubject" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vehicle_user_assignments_vehicles_TenantId_VehicleId",
                        columns: x => new { x.TenantId, x.VehicleId },
                        principalTable: "vehicles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "permission_definitions",
                columns: new[] { "Code", "Name" },
                values: new object[] { "vehicles.users.assign", "Jármű felhasználóhoz rendelése" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_photos_TenantId_VehicleId_Slot",
                table: "vehicle_photos",
                columns: new[] { "TenantId", "VehicleId", "Slot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_user_assignments_TenantId_UserId_ReleasedAt",
                table: "vehicle_user_assignments",
                columns: new[] { "TenantId", "UserId", "ReleasedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_vehicle_user_assignments_TenantId_VehicleId",
                table: "vehicle_user_assignments",
                columns: new[] { "TenantId", "VehicleId" },
                unique: true,
                filter: "\"ReleasedAt\" IS NULL");
            foreach (var table in new[] { "vehicle_photos", "vehicle_user_assignments", "vehicle_model_options" })
            {
                migrationBuilder.Sql($"""
                    ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                    CREATE POLICY tenant_isolation ON {table}
                    USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                    WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                    """);
            }
            migrationBuilder.Sql("""
                DO $$ DECLARE company uuid; BEGIN
                  FOR company IN SELECT "Id" FROM tenants LOOP
                    PERFORM set_config('app.tenant_id', company::text, true);
                    INSERT INTO vehicle_model_options ("TenantId", "MakeKey", "ModelKey", "Make", "Model")
                    SELECT "TenantId", upper(trim("Make") COLLATE "unicode"), upper(trim("Model") COLLATE "unicode"), min(trim("Make")), min(trim("Model"))
                    FROM vehicles GROUP BY "TenantId", upper(trim("Make") COLLATE "unicode"), upper(trim("Model") COLLATE "unicode")
                    ON CONFLICT DO NOTHING;
                  END LOOP;
                  PERFORM set_config('app.tenant_id', '', true);
                END $$;
                CREATE FUNCTION protect_vehicle_photo() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Replace photos instead of rewriting their identity or pixels' USING ERRCODE = '55000'; END $$;
                CREATE TRIGGER vehicle_photo_immutable BEFORE UPDATE ON vehicle_photos FOR EACH ROW EXECUTE FUNCTION protect_vehicle_photo();
                CREATE FUNCTION protect_vehicle_user_history() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Assignment history cannot be deleted' USING ERRCODE = '55000'; END IF;
                  IF (to_jsonb(NEW) - ARRAY['ReleasedAt','ReleasedBy']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['ReleasedAt','ReleasedBy'])
                     OR OLD."ReleasedAt" IS NOT NULL OR NEW."ReleasedAt" IS NULL OR NEW."ReleasedBy" IS NULL THEN
                    RAISE EXCEPTION 'Only an active assignment may be closed' USING ERRCODE = '55000';
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER vehicle_user_history_immutable BEFORE UPDATE OR DELETE ON vehicle_user_assignments FOR EACH ROW EXECUTE FUNCTION protect_vehicle_user_history();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException("Restore the database backup with its matching application version to preserve photographs and assignment history.");
        }
    }
}
