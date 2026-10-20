using Microsoft.EntityFrameworkCore.Migrations;

namespace Hermes.Infrastructure.Migrations;

internal static class OrganizationSql
{
    internal static void Apply(MigrationBuilder migration)
    {
        migration.Sql("""
            INSERT INTO company_profiles ("TenantId", "CountryCode", "Currency", "DistanceUnit", "Version")
            SELECT "Id", 'HU', 'HUF', 'km', 1 FROM tenants;
            CREATE FUNCTION prevent_company_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'Company audit events are append-only' USING ERRCODE = '55000';
            END $$;
            CREATE TRIGGER company_audit_append_only BEFORE UPDATE OR DELETE ON access_audit_events
                FOR EACH ROW EXECUTE FUNCTION prevent_company_audit_mutation();
            """);
        foreach (var table in new[] { "company_profiles", "company_contacts", "company_sites", "vehicle_site_assignments" })
            migration.Sql($"""
                ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {table}
                    USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                    WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                """);
    }
}
