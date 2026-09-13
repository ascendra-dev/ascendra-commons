-- Reference migration — see file-record.migration.sql for the "not run by this library" note.

CREATE TABLE IF NOT EXISTS "commons_file_rejection" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL,
  "actor_id"     text NOT NULL,
  "category"     text NOT NULL,          -- requested category key; may not resolve to a real/active category
  "filename"     text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes"   bigint NOT NULL,
  "reason"       text NOT NULL,          -- 'category-unavailable' | 'validation-failed' | 'scan-rejected'
  "message"      text NOT NULL,
  "occurred_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commons_file_rejection_tenant_idx"
  ON "commons_file_rejection" ("tenant_id", "occurred_at");
-- The retention cron (DELETE FROM commons_file_rejection WHERE occurred_at < now() - interval 'N days') scans on this.
CREATE INDEX IF NOT EXISTS "commons_file_rejection_occurred_at_idx"
  ON "commons_file_rejection" ("occurred_at");
