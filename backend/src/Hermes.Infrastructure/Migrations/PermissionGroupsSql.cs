using Microsoft.EntityFrameworkCore.Migrations;

namespace Hermes.Infrastructure.Migrations;

internal static class PermissionGroupsSql
{
    internal static void Apply(MigrationBuilder migration)
    {
        // Existing direct grants survive. Only evidenced company creators/legacy owners with
        // every original right receive the future-expanding admin bundle, never ordinary grantees.
        migration.Sql("""
            DO $$ DECLARE tenant uuid; admin_id uuid; BEGIN
              FOR tenant IN SELECT "Id" FROM tenants LOOP
                PERFORM set_config('app.tenant_id', tenant::text, true);
                admin_id := gen_random_uuid();
                INSERT INTO permission_groups ("TenantId", "Id", "Name", "NormalizedName", "IsAdmin", "Version")
                  VALUES (tenant, admin_id, 'admin', 'ADMIN', true, 1);
                INSERT INTO tenant_membership_groups ("TenantId", "UserSubject", "GroupId")
                  SELECT tenant, m."UserSubject", admin_id FROM tenant_memberships m
                  WHERE m."TenantId" = tenant AND m."IsActive"
                    AND (SELECT count(*) FROM tenant_membership_permissions p WHERE p."TenantId" = tenant AND p."UserSubject" = m."UserSubject"
                      AND p."Code" IN ('vehicles.read','vehicles.create','members.read','members.invite','members.update','permissions.manage','audit.read')) = 7
                    AND EXISTS (SELECT 1 FROM access_audit_events a WHERE a."TenantId" = tenant
                      AND COALESCE((SELECT h."UserId" FROM user_identity_history h WHERE h."PreviousId" = a."TargetSubject"), a."TargetSubject") = m."UserSubject"
                      AND (a."Action" = 'company.created' OR (a."Action" = 'permissions.migrated' AND a."Details"->>'legacyRole' = 'Owner')));
                UPDATE tenant_memberships m SET "Version" = "Version" + 1 WHERE m."TenantId" = tenant
                  AND (EXISTS (SELECT 1 FROM tenant_membership_groups g WHERE g."TenantId" = tenant AND g."UserSubject" = m."UserSubject")
                    OR EXISTS (SELECT 1 FROM tenant_membership_permissions p WHERE p."TenantId" = tenant AND p."UserSubject" = m."UserSubject" AND p."Code" = 'permissions.manage'));
                INSERT INTO access_audit_events ("TenantId","Id","ActorSubject","TargetSubject","Action","Details","CreatedAt")
                  SELECT tenant, gen_random_uuid(), 'system:migration', g."UserSubject", 'member.admin_group_migrated',
                    jsonb_build_object('groupId', admin_id, 'reason', 'evidenced_company_owner'), now()
                  FROM tenant_membership_groups g WHERE g."TenantId" = tenant;
                INSERT INTO tenant_membership_permissions ("TenantId","UserSubject","Code")
                  SELECT tenant, p."UserSubject", 'permission-groups.manage' FROM tenant_membership_permissions p
                    WHERE p."TenantId" = tenant AND p."Code" = 'permissions.manage' ON CONFLICT DO NOTHING;
                INSERT INTO access_audit_events ("TenantId","Id","ActorSubject","TargetSubject","Action","Details","CreatedAt")
                  SELECT tenant, gen_random_uuid(), 'system:migration', p."UserSubject", 'member.group_management_migrated',
                    '{"permission":"permission-groups.manage"}'::jsonb, now()
                  FROM tenant_membership_permissions p WHERE p."TenantId" = tenant AND p."Code" = 'permission-groups.manage';
                INSERT INTO system_audit_events ("Id","ActorSubject","TargetSubject","TenantId","Action","Details","CreatedAt")
                  SELECT "Id","ActorSubject","TargetSubject","TenantId","Action","Details","CreatedAt" FROM access_audit_events
                  WHERE "TenantId" = tenant AND "Action" IN ('member.admin_group_migrated','member.group_management_migrated');
              END LOOP;
              PERFORM set_config('app.tenant_id', '', true);
            END $$;
            CREATE FUNCTION protect_admin_group() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
              IF OLD."IsAdmin" THEN RAISE EXCEPTION 'The admin group is managed automatically' USING ERRCODE = '55000'; END IF;
              IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
              IF NEW."IsAdmin" THEN RAISE EXCEPTION 'Custom groups cannot become admin' USING ERRCODE = '55000'; END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER permission_groups_protect_admin BEFORE UPDATE OR DELETE ON permission_groups
              FOR EACH ROW EXECUTE FUNCTION protect_admin_group();
            CREATE TRIGGER odometer_append_only BEFORE UPDATE OR DELETE ON vehicle_odometer_readings
              FOR EACH ROW EXECUTE FUNCTION prevent_system_audit_mutation();
            """);
        foreach (var table in new[] { "permission_groups", "permission_group_permissions", "tenant_membership_groups", "vehicle_odometer_readings" })
            migration.Sql($"""
                ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {table}
                    USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                    WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                """);
    }
}
