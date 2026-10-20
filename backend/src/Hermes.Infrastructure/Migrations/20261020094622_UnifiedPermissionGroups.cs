using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Hermes.Infrastructure.Migrations;

public partial class UnifiedPermissionGroups : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey("FK_company_access_groups_identity_users_CreatedBy", "company_access_groups");
        migrationBuilder.DropForeignKey("FK_company_access_users_identity_users_UserId", "company_access_users");
        migrationBuilder.DropIndex("IX_company_access_users_UserId", "company_access_users");
        migrationBuilder.DropIndex("IX_company_access_groups_CreatedBy_NormalizedName", "company_access_groups");
        migrationBuilder.AddColumn<bool>("IsAdmin", "company_access_groups", "boolean", nullable: false, defaultValue: false);
        migrationBuilder.CreateIndex("IX_company_access_groups_NormalizedName", "company_access_groups", "NormalizedName");
        migrationBuilder.Sql("""
            -- Do not merge names: identically named groups may have different members and authority.
            -- RLS remains forced throughout. Read/copy each legacy company in its own tenant context.
            CREATE TEMP TABLE unified_group_users (subject text PRIMARY KEY) ON COMMIT DROP;
            DO $$ DECLARE tenant uuid; legacy record; new_id uuid; details jsonb; BEGIN
              PERFORM pg_advisory_xact_lock(724385916);
              FOR tenant IN SELECT "Id" FROM tenants ORDER BY "Id" LOOP
                PERFORM set_config('app.tenant_id', tenant::text, true);
                FOR legacy IN SELECT * FROM permission_groups WHERE "TenantId" = tenant ORDER BY "Id" LOOP
                  new_id := legacy."Id";
                  WHILE EXISTS (SELECT 1 FROM company_access_groups WHERE "Id" = new_id) LOOP new_id := gen_random_uuid(); END LOOP;
                  INSERT INTO company_access_groups ("Id","CreatedBy","Name","NormalizedName","IsAdmin","AllPermissions","Version")
                    VALUES (new_id, 'system:migration', legacy."Name", legacy."NormalizedName", legacy."IsAdmin", legacy."IsAdmin", legacy."Version" + 1);
                  INSERT INTO company_access_scopes ("GroupId","TenantId") VALUES (new_id,tenant);
                  INSERT INTO company_access_permissions ("GroupId","Code")
                    SELECT new_id,"Code" FROM permission_group_permissions WHERE "TenantId"=tenant AND "GroupId"=legacy."Id";
                  -- Orphan subjects are retained too; identity history already reserves these names.
                  INSERT INTO company_access_users ("GroupId","UserId")
                    SELECT new_id,"UserSubject" FROM tenant_membership_groups WHERE "TenantId"=tenant AND "GroupId"=legacy."Id";
                  INSERT INTO company_access_memberships ("TenantId","UserSubject","GroupId")
                    SELECT tenant,"UserSubject",new_id FROM tenant_membership_groups WHERE "TenantId"=tenant AND "GroupId"=legacy."Id";
                  INSERT INTO unified_group_users SELECT "UserSubject" FROM tenant_membership_groups
                    WHERE "TenantId"=tenant AND "GroupId"=legacy."Id" ON CONFLICT DO NOTHING;
                  details := jsonb_build_object('previousGroupId',legacy."Id",'groupId',new_id,'name',legacy."Name",'companyIds',jsonb_build_array(tenant));
                  INSERT INTO access_audit_events ("TenantId","Id","ActorSubject","Action","Details","CreatedAt")
                    VALUES (tenant,gen_random_uuid(),'system:migration','group.unified',details,now());
                  INSERT INTO system_audit_events ("Id","ActorSubject","TenantId","Action","Details","CreatedAt")
                    VALUES (gen_random_uuid(),'system:migration',tenant,'group.unified',details,now());
                END LOOP;
                UPDATE tenant_memberships m SET "Version"="Version"+1 WHERE m."TenantId"=tenant AND
                  EXISTS (SELECT 1 FROM tenant_membership_groups g WHERE g."TenantId"=tenant AND g."UserSubject"=m."UserSubject");
              END LOOP;
              INSERT INTO user_identity_history ("PreviousId","UserId")
                SELECT subject,null FROM unified_group_users u WHERE NOT EXISTS (SELECT 1 FROM identity_users i WHERE i."Id"=u.subject)
                ON CONFLICT DO NOTHING;
              UPDATE identity_users SET "ProfileVersion"="ProfileVersion"+1 WHERE "Id" IN (SELECT subject FROM unified_group_users);
              PERFORM set_config('app.tenant_id','',true);
            END $$;
            """);
        migrationBuilder.DropTable("permission_group_permissions");
        migrationBuilder.DropTable("tenant_membership_groups");
        migrationBuilder.DropTable("permission_groups");
        migrationBuilder.Sql("""
            DROP FUNCTION protect_admin_group();
            CREATE FUNCTION protect_unified_admin_group() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
              IF TG_OP='DELETE' THEN
                IF OLD."IsAdmin" THEN RAISE EXCEPTION 'Admin groups cannot be deleted' USING ERRCODE='55000'; END IF;
                RETURN OLD;
              END IF;
              IF NEW."IsAdmin" IS DISTINCT FROM OLD."IsAdmin" OR (OLD."IsAdmin" AND
                (NEW."Name" <> OLD."Name" OR NEW."NormalizedName" <> OLD."NormalizedName" OR NOT NEW."AllPermissions"))
              THEN RAISE EXCEPTION 'Admin name and automatic rights are protected' USING ERRCODE='55000'; END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER unified_admin_protected BEFORE UPDATE OR DELETE ON company_access_groups
              FOR EACH ROW EXECUTE FUNCTION protect_unified_admin_group();
            """);
    }
    protected override void Down(MigrationBuilder migrationBuilder)
        => throw new NotSupportedException("Unified access cannot be split without losing provenance. Restore a database backup to roll back.");
}
