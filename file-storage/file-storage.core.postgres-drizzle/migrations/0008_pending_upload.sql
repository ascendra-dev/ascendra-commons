-- file-storage · direct uploads begun and not yet completed. Never edited once released — see 0001's header.

CREATE TABLE IF NOT EXISTS "commons_file_pending_upload" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        text NOT NULL,
  "actor_id"         text NOT NULL,
  "category"         text NOT NULL,
  "attached_to_type" text NOT NULL,
  "attached_to_id"   text NOT NULL,
  "filename"         text NOT NULL,
  "content_type"     text NOT NULL,
  "size_bytes"       bigint NOT NULL,
  "file_ref"         text NOT NULL,                -- where the object lands — reserved, not yet written
  "expires_at"       timestamptz NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

-- The retention run: uploads whose URL expired without a complete.
CREATE INDEX IF NOT EXISTS "commons_file_pending_upload_expires_idx"
  ON "commons_file_pending_upload" ("expires_at");
