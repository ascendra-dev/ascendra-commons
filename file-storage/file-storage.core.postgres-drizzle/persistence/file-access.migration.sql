-- Reference migration — see file-record.migration.sql for the "not run by this library" note.

CREATE TABLE IF NOT EXISTS "commons_file_access" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_record_id" uuid NOT NULL REFERENCES "commons_file_record" ("id") ON DELETE CASCADE,
  "tenant_id"      uuid NOT NULL,
  "actor_id"       text,                          -- NULL for a signed-link fetch
  "via"            text NOT NULL,                 -- 'actor' | 'signed-link'
  "purpose"        text NOT NULL,
  "occurred_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commons_file_access_file_idx"
  ON "commons_file_access" ("file_record_id", "occurred_at");
-- The retention cron (DELETE FROM commons_file_access WHERE occurred_at < now() - interval 'N days') scans on this.
CREATE INDEX IF NOT EXISTS "commons_file_access_occurred_at_idx"
  ON "commons_file_access" ("occurred_at");
