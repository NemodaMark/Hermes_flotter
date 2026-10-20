namespace Hermes.Infrastructure.Migrations;

internal static class UsernameIdentitySql
{
    internal const string Convert = """
        LOCK TABLE identity_users IN ACCESS EXCLUSIVE MODE;

        -- This migration runs in one transaction with the API stopped. The owner may
        -- disable RLS for the rewrite; all original policies and FORCE RLS are restored.
        ALTER TABLE tenant_membership_permissions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE tenant_invitations DISABLE ROW LEVEL SECURITY;
        ALTER TABLE tenant_invitation_permissions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE access_audit_events DISABLE ROW LEVEL SECURITY;
        ALTER TABLE vehicles DISABLE ROW LEVEL SECURITY;

        INSERT INTO user_identity_history ("PreviousId", "UserId")
        SELECT subject, NULL FROM (
            SELECT "Id" AS subject FROM identity_users
            UNION SELECT "UserSubject" FROM tenant_memberships
            UNION SELECT "ActorSubject" FROM access_audit_events
            UNION SELECT "TargetSubject" FROM access_audit_events
            UNION SELECT "InvitedBy" FROM tenant_invitations
            UNION SELECT "ActorSubject" FROM system_audit_events
            UNION SELECT "TargetSubject" FROM system_audit_events
        ) subjects WHERE subject IS NOT NULL;

        CREATE TEMP TABLE username_conversion (old_id text PRIMARY KEY, new_id text UNIQUE NOT NULL) ON COMMIT DROP;
        DO $$
        DECLARE account record; base_name text; candidate text; suffix text; counter integer;
        BEGIN
            FOR account IN SELECT "Id", "Email", "UserName" FROM identity_users ORDER BY "Id" COLLATE "C" LOOP
                base_name := lower(split_part(coalesce(nullif(account."Email", ''), nullif(account."UserName", ''), 'user'), '@', 1));
                base_name := translate(base_name, 'áéíóöőúüű', 'aeiooouuu');
                base_name := btrim(regexp_replace(base_name, '[^a-z0-9._-]+', '.', 'g'), '._-');
                IF length(base_name) < 3 THEN base_name := 'user.' || base_name; END IF;
                base_name := left(base_name, 64);
                candidate := base_name;
                counter := 1;
                WHILE EXISTS(SELECT 1 FROM user_identity_history WHERE "ReservedName" = candidate)
                    OR EXISTS(SELECT 1 FROM username_conversion WHERE new_id = candidate) LOOP
                    counter := counter + 1;
                    suffix := '.' || counter::text;
                    candidate := left(base_name, 64 - length(suffix)) || suffix;
                END LOOP;
                INSERT INTO username_conversion VALUES (account."Id", candidate);
            END LOOP;
        END $$;

        -- Keep each original FK definition, including Identity's delete behavior.
        CREATE TEMP TABLE username_foreign_keys ON COMMIT DROP AS
        SELECT conrelid::regclass AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('identity_users'::regclass, 'tenant_memberships'::regclass);
        DO $$ DECLARE item record; BEGIN
            FOR item IN SELECT * FROM username_foreign_keys LOOP
                EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.table_name, item.constraint_name);
            END LOOP;
        END $$;

        -- Avoid transient conflicts with old normalized usernames during conversion.
        UPDATE identity_users SET "UserName" = NULL, "NormalizedUserName" = NULL;
        UPDATE identity_users account SET "Id" = names.new_id, "UserName" = names.new_id,
            "NormalizedUserName" = upper(names.new_id), "SecurityStamp" = gen_random_uuid()::text,
            "ConcurrencyStamp" = gen_random_uuid()::text, "ProfileVersion" = "ProfileVersion" + 1
        FROM username_conversion names WHERE account."Id" = names.old_id;

        UPDATE identity_user_claims item SET "UserId" = names.new_id FROM username_conversion names WHERE item."UserId" = names.old_id;
        UPDATE identity_user_logins item SET "UserId" = names.new_id FROM username_conversion names WHERE item."UserId" = names.old_id;
        UPDATE identity_user_tokens item SET "UserId" = names.new_id FROM username_conversion names WHERE item."UserId" = names.old_id;
        UPDATE identity_user_roles item SET "UserId" = names.new_id FROM username_conversion names WHERE item."UserId" = names.old_id;
        UPDATE system_permission_grants item SET "UserId" = names.new_id FROM username_conversion names WHERE item."UserId" = names.old_id;
        UPDATE tenant_memberships item SET "UserSubject" = names.new_id FROM username_conversion names WHERE item."UserSubject" = names.old_id;
        UPDATE tenant_membership_permissions item SET "UserSubject" = names.new_id FROM username_conversion names WHERE item."UserSubject" = names.old_id;
        UPDATE tenant_invitations item SET "InvitedBy" = names.new_id FROM username_conversion names WHERE item."InvitedBy" = names.old_id;

        UPDATE user_identity_history item SET "UserId" = names.new_id FROM username_conversion names WHERE item."PreviousId" = names.old_id;
        INSERT INTO user_identity_history ("PreviousId", "UserId") SELECT new_id, new_id FROM username_conversion;

        DO $$ DECLARE item record; BEGIN
            FOR item IN SELECT * FROM username_foreign_keys LOOP
                EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.table_name, item.constraint_name, item.definition);
            END LOOP;
        END $$;

        -- Historical audit rows are never rewritten. Read APIs resolve their original
        -- IDs through the immutable history, returning both old and current subjects.
        INSERT INTO system_audit_events ("Id", "ActorSubject", "TargetSubject", "TenantId", "Action", "Details", "CreatedAt")
        SELECT gen_random_uuid(), 'migration:username-id', new_id, NULL, 'user.id_migrated',
            jsonb_build_object('previousId', old_id, 'userName', new_id), CURRENT_TIMESTAMP FROM username_conversion;

        ALTER TABLE tenant_membership_permissions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE tenant_membership_permissions FORCE ROW LEVEL SECURITY;
        ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE tenant_invitations FORCE ROW LEVEL SECURITY;
        ALTER TABLE tenant_invitation_permissions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE tenant_invitation_permissions FORCE ROW LEVEL SECURITY;
        ALTER TABLE access_audit_events ENABLE ROW LEVEL SECURITY;
        ALTER TABLE access_audit_events FORCE ROW LEVEL SECURITY;
        ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
        ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;

        CREATE FUNCTION protect_username_identity() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'UPDATE' AND NEW."Id" IS DISTINCT FROM OLD."Id" THEN
                RAISE EXCEPTION 'The username primary key is permanent' USING ERRCODE = '23514';
            END IF;
            IF TG_OP = 'INSERT' AND EXISTS(SELECT 1 FROM user_identity_history WHERE "ReservedName" = lower(NEW."Id")) THEN
                RAISE EXCEPTION 'Username is reserved' USING ERRCODE = '23505', CONSTRAINT = 'username_reserved';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER protect_username_identity BEFORE INSERT OR UPDATE ON identity_users
            FOR EACH ROW EXECUTE FUNCTION protect_username_identity();
        CREATE FUNCTION protect_user_identity_history() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Identity history is append-only' USING ERRCODE = '55000';
        END $$;
        CREATE TRIGGER user_identity_history_append_only BEFORE UPDATE OR DELETE ON user_identity_history
            FOR EACH ROW EXECUTE FUNCTION protect_user_identity_history();
        """;
}
