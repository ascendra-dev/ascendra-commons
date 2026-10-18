-- file-storage · Postgres/Drizzle adapter — the file record table.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/file-record.schema.ts` and the store's SQL
-- — change them together.

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
