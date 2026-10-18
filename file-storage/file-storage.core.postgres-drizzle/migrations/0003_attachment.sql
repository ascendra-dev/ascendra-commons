-- file-storage · attachments (needs 0001's commons_file_record). Never edited once
-- released — see 0001's header.

CREATE TABLE IF NOT EXISTS "commons_attachment" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "file_record_id"   uuid NOT NULL REFERENCES "commons_file_record" ("id") ON DELETE CASCADE,
  "attached_to_type" text NOT NULL,
  "attached_to_id"   text NOT NULL,
  "category"         text NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commons_attachment_entity_idx"
  ON "commons_attachment" ("attached_to_type", "attached_to_id");
CREATE INDEX IF NOT EXISTS "commons_attachment_file_record_idx"
  ON "commons_attachment" ("file_record_id");
