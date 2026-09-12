-- Reference migration for the file-storage pattern's Postgres/Drizzle adapter.
--
-- This library never runs migrations against a consumer's database
-- (MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `fileRecordTable` from `file-record.schema.ts`
-- and let `drizzle-kit generate` produce the equivalent. Keep the three in sync
-- (schema, this file, the store's SQL).

CREATE TABLE IF NOT EXISTS "commons_file_record" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL,
  "file_ref"     text NOT NULL,                 -- "{bucket}/{objectKey}", opaque to callers
  "category"     text NOT NULL,                 -- a FileCategory key
  "content_type" text NOT NULL,
  "size_bytes"   bigint NOT NULL,
  "content_hash" text,                          -- SHA-256 hex; passive (forensics / future dedupe)
  "uploaded_by"  text NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commons_file_record_tenant_category_idx"
  ON "commons_file_record" ("tenant_id", "category", "created_at");
CREATE INDEX IF NOT EXISTS "commons_file_record_created_at_idx"
  ON "commons_file_record" ("created_at");
CREATE INDEX IF NOT EXISTS "commons_file_record_content_hash_idx"
  ON "commons_file_record" ("content_hash");
