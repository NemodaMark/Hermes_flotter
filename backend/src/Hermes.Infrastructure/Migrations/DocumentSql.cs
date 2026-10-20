using Microsoft.EntityFrameworkCore.Migrations;

namespace Hermes.Infrastructure.Migrations;

internal static class DocumentSql
{
    internal static void Apply(MigrationBuilder migration)
    {
        foreach (var table in new[] { "vehicle_documents", "vehicle_document_contents" })
            migration.Sql($"""
                ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
                ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
                CREATE POLICY tenant_isolation ON {table}
                  USING ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid)
                  WITH CHECK ("TenantId" = nullif(current_setting('app.tenant_id', true), '')::uuid);
                """);
        migration.Sql("""
            CREATE FUNCTION protect_vehicle_document_content() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Document contents are immutable' USING ERRCODE = '55000'; END $$;
            CREATE TRIGGER document_content_immutable BEFORE UPDATE OR DELETE ON vehicle_document_contents
              FOR EACH ROW EXECUTE FUNCTION protect_vehicle_document_content();
            CREATE FUNCTION protect_vehicle_document_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Withdraw documents instead of deleting them' USING ERRCODE = '55000'; END IF;
              IF ROW(OLD."TenantId",OLD."Id",OLD."LeaseId",OLD."ServiceId",OLD."FileName",OLD."ContentType",OLD."ByteLength",OLD."Sha256",OLD."UploadedBy",OLD."UploadedAt")
                IS DISTINCT FROM ROW(NEW."TenantId",NEW."Id",NEW."LeaseId",NEW."ServiceId",NEW."FileName",NEW."ContentType",NEW."ByteLength",NEW."Sha256",NEW."UploadedBy",NEW."UploadedAt")
                THEN RAISE EXCEPTION 'Original document metadata is immutable' USING ERRCODE = '55000'; END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER document_metadata_immutable BEFORE UPDATE OR DELETE ON vehicle_documents
              FOR EACH ROW EXECUTE FUNCTION protect_vehicle_document_metadata();
            """);
    }
}
