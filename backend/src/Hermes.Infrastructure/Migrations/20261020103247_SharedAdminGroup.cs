using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hermes.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SharedAdminGroup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_company_access_memberships_GroupId_UserSubject",
                table: "company_access_memberships");

            migrationBuilder.CreateTable(
                name: "group_user_companies",
                columns: table => new
                {
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_group_user_companies", x => new { x.GroupId, x.UserId, x.TenantId });
                    table.ForeignKey(
                        name: "FK_group_user_companies_company_access_scopes_GroupId_TenantId",
                        columns: x => new { x.GroupId, x.TenantId },
                        principalTable: "company_access_scopes",
                        principalColumns: new[] { "GroupId", "TenantId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_group_user_companies_company_access_users_GroupId_UserId",
                        columns: x => new { x.GroupId, x.UserId },
                        principalTable: "company_access_users",
                        principalColumns: new[] { "GroupId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.Sql("""
                -- Capture effects from tenant projections, never from a user/company cross product.
                CREATE TEMP TABLE shared_admin_definitions ON COMMIT DROP AS
                  SELECT "Id","Version" FROM company_access_groups WHERE "IsAdmin";
                CREATE TEMP TABLE shared_admin_scopes ON COMMIT DROP AS
                  SELECT "GroupId","TenantId" FROM company_access_scopes WHERE "GroupId" IN (SELECT "Id" FROM shared_admin_definitions);
                CREATE TEMP TABLE shared_admin_users ON COMMIT DROP AS
                  SELECT DISTINCT "UserId" FROM company_access_users WHERE "GroupId" IN (SELECT "Id" FROM shared_admin_definitions);
                CREATE TEMP TABLE shared_admin_effects (company_id uuid, subject text, PRIMARY KEY (company_id,subject)) ON COMMIT DROP;
                DROP TRIGGER unified_admin_protected ON company_access_groups;
                DO $$ DECLARE admin_id uuid; tenant uuid; BEGIN
                  PERFORM pg_advisory_xact_lock(724385916);
                  SELECT "Id" INTO admin_id FROM shared_admin_definitions ORDER BY "Id" LIMIT 1;
                  IF admin_id IS NULL THEN
                    admin_id := gen_random_uuid();
                    WHILE EXISTS (SELECT 1 FROM company_access_groups WHERE "Id"=admin_id) LOOP admin_id := gen_random_uuid(); END LOOP;
                    INSERT INTO company_access_groups ("Id","CreatedBy","Name","NormalizedName","IsAdmin","AllPermissions","Version")
                      VALUES (admin_id,'system','admin','ADMIN',true,true,1);
                  ELSE
                    UPDATE company_access_groups SET "Version"=(SELECT max("Version")+1 FROM shared_admin_definitions)
                      WHERE "Id"=admin_id;
                  END IF;
                  INSERT INTO company_access_users ("GroupId","UserId") SELECT admin_id,"UserId" FROM shared_admin_users ON CONFLICT DO NOTHING;
                  FOR tenant IN SELECT "Id" FROM tenants ORDER BY "Id" LOOP
                    PERFORM set_config('app.tenant_id',tenant::text,true);
                    INSERT INTO shared_admin_effects SELECT DISTINCT tenant,m."UserSubject" FROM company_access_memberships m
                      WHERE m."TenantId"=tenant AND m."GroupId" IN (SELECT "Id" FROM shared_admin_definitions) ON CONFLICT DO NOTHING;
                    -- Backfill assignment scope for ordinary groups too, without changing their effects.
                    INSERT INTO group_user_companies ("GroupId","UserId","TenantId")
                      SELECT "GroupId","UserSubject",tenant FROM company_access_memberships WHERE "TenantId"=tenant ON CONFLICT DO NOTHING;
                    INSERT INTO company_access_scopes ("GroupId","TenantId") VALUES (admin_id,tenant) ON CONFLICT DO NOTHING;
                    INSERT INTO group_user_companies ("GroupId","UserId","TenantId")
                      SELECT admin_id,subject,tenant FROM shared_admin_effects WHERE shared_admin_effects.company_id=tenant ON CONFLICT DO NOTHING;
                    INSERT INTO company_access_memberships ("GroupId","UserSubject","TenantId")
                      SELECT admin_id,subject,tenant FROM shared_admin_effects WHERE shared_admin_effects.company_id=tenant ON CONFLICT DO NOTHING;
                    DELETE FROM company_access_memberships WHERE "TenantId"=tenant AND "GroupId"<>admin_id AND "GroupId" IN (SELECT "Id" FROM shared_admin_definitions);
                    DELETE FROM group_user_companies WHERE "TenantId"=tenant AND "GroupId"<>admin_id AND "GroupId" IN (SELECT "Id" FROM shared_admin_definitions);
                    UPDATE tenant_memberships m SET "Version"="Version"+1 WHERE m."TenantId"=tenant
                      AND EXISTS (SELECT 1 FROM shared_admin_effects e WHERE e.company_id=tenant AND e.subject=m."UserSubject");
                    INSERT INTO access_audit_events ("TenantId","Id","ActorSubject","Action","Details","CreatedAt")
                      SELECT tenant,gen_random_uuid(),'system:migration','admin_group.consolidated',
                        jsonb_build_object('previousGroupId',d."Id",'groupId',admin_id,'companyId',tenant),now()
                      FROM shared_admin_definitions d JOIN shared_admin_scopes c ON c."GroupId"=d."Id" AND c."TenantId"=tenant;
                  END LOOP;
                  UPDATE identity_users SET "ProfileVersion"="ProfileVersion"+1 WHERE "Id" IN (SELECT "UserId" FROM shared_admin_users);
                  INSERT INTO system_audit_events ("Id","ActorSubject","Action","Details","CreatedAt")
                    SELECT gen_random_uuid(),'system:migration','admin_group.consolidated',
                      jsonb_build_object('previousGroupId',d."Id",'groupId',admin_id,'previousVersion',d."Version"),now()
                    FROM shared_admin_definitions d;
                  DELETE FROM company_access_groups WHERE "IsAdmin" AND "Id"<>admin_id;
                  PERFORM set_config('app.tenant_id','',true);
                END $$;
                CREATE TRIGGER unified_admin_protected BEFORE UPDATE OR DELETE ON company_access_groups
                  FOR EACH ROW EXECUTE FUNCTION protect_unified_admin_group();
                """);

            migrationBuilder.CreateIndex(
                name: "IX_company_access_memberships_GroupId_UserSubject_TenantId",
                table: "company_access_memberships",
                columns: new[] { "GroupId", "UserSubject", "TenantId" });

            migrationBuilder.CreateIndex(
                name: "IX_company_access_groups_IsAdmin",
                table: "company_access_groups",
                column: "IsAdmin",
                unique: true,
                filter: "\"IsAdmin\"");

            migrationBuilder.CreateIndex(
                name: "IX_group_user_companies_GroupId_TenantId",
                table: "group_user_companies",
                columns: new[] { "GroupId", "TenantId" });

            migrationBuilder.AddForeignKey(
                name: "FK_company_access_memberships_group_user_companies_GroupId_Use~",
                table: "company_access_memberships",
                columns: new[] { "GroupId", "UserSubject", "TenantId" },
                principalTable: "group_user_companies",
                principalColumns: new[] { "GroupId", "UserId", "TenantId" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
            => throw new NotSupportedException("A shared admin assignment cannot be split safely. Restore a database backup to roll back.");
    }
}
