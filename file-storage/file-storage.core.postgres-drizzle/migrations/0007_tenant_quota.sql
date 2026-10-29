-- file-storage · per-tenant storage limits, and the duplicates report. Never edited once released — see 0001's header.

CREATE TABLE IF NOT EXISTS "commons_file_tenant_quota" (
  "tenant_id"  text PRIMARY KEY,
  "max_bytes"  bigint NOT NULL CHECK ("max_bytes" > 0),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text NOT NULL
);

-- A tenant's usage — SUM(size_bytes) — on every upload under a limit: an index-only scan with size_bytes included.
CREATE INDEX IF NOT EXISTS "commons_file_record_tenant_size_idx"
  ON "commons_file_record" ("tenant_id") INCLUDE ("size_bytes");

-- The duplicates report: a tenant's files grouped by content hash.
CREATE INDEX IF NOT EXISTS "commons_file_record_tenant_hash_idx"
  ON "commons_file_record" ("tenant_id", "content_hash") WHERE "content_hash" IS NOT NULL;
