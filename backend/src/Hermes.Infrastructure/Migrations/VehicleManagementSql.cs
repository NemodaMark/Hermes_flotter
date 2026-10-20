using Microsoft.EntityFrameworkCore.Migrations;

namespace Hermes.Infrastructure.Migrations;

internal static class VehicleManagementSql
{
    internal static void Apply(MigrationBuilder migration)
    {
        // vehicles already has FORCE RLS; migrate each company's existing fleet in its own context.
        migration.Sql("""
            DO $$ DECLARE company uuid; BEGIN
              FOR company IN SELECT "Id" FROM tenants LOOP
                PERFORM set_config('app.tenant_id', company::text, true);
                INSERT INTO vehicle_profiles ("TenantId","VehicleId","RegistrationCountry","Category","FuelType","Transmission","Ownership")
                  SELECT "TenantId","Id",'HU','Unknown','Unknown','Unknown','Unknown' FROM vehicles;
                INSERT INTO vehicle_registration_history ("TenantId","Id","VehicleId","Registration","CountryCode","RecordedBy","RecordedAt")
                  SELECT "TenantId",gen_random_uuid(),"Id","Registration",'HU','system:migration',"CreatedAt" FROM vehicles;
              END LOOP;
              PERFORM set_config('app.tenant_id', '', true);
            END $$;
            CREATE FUNCTION prevent_registration_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Registration history is append-only' USING ERRCODE = '55000'; END $$;
            CREATE TRIGGER registration_append_only BEFORE UPDATE OR DELETE ON vehicle_registration_history
              FOR EACH ROW EXECUTE FUNCTION prevent_registration_mutation();
            """);
        foreach (var table in new[] { "vehicle_profiles", "vehicle_registration_history", "fleet_partners", "vehicle_leases", "vehicle_services" })
            migration.Sql($"""
                ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {table}
                  USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                  WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                """);
    }
}
