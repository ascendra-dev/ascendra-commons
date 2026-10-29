-- file-storage · what an upload was, how long it must be kept, and whether it is held.
-- Never edited once released — see 0001's header.

-- 1. Tenant ids are text — the same as every other commons module and `Actor.tenantId`. A uuid column refused
--    every upload from a tenant whose id isn't a uuid (`tenant_acme`). Widening keeps existing values.
ALTER TABLE "commons_file_record"    ALTER COLUMN "tenant_id" TYPE text;
ALTER TABLE "commons_file_category"  ALTER COLUMN "tenant_id" TYPE text;
ALTER TABLE "commons_file_access"    ALTER COLUMN "tenant_id" TYPE text;
ALTER TABLE "commons_file_rejection" ALTER COLUMN "tenant_id" TYPE text;

-- 2. What was uploaded and what the scanner said. NULL on rows written before this migration.
ALTER TABLE "commons_file_record" ADD COLUMN IF NOT EXISTS "filename"     text;  -- the uploader's name for it, cleaned
ALTER TABLE "commons_file_record" ADD COLUMN IF NOT EXISTS "scan_verdict" text;  -- 'clean' | 'unscannable' (an infected file is never stored)

-- 3. Retention, fixed at upload from the category's keepForDays: the file can't be deleted before this, and the
--    retention run deletes it after. NULL = indefinite (kept until someone deletes it).
ALTER TABLE "commons_file_record" ADD COLUMN IF NOT EXISTS "retain_until" timestamptz;

-- 4. Legal hold — no one deletes a held file, and retention skips it, until the hold is released.
ALTER TABLE "commons_file_record" ADD COLUMN IF NOT EXISTS "held_at"     timestamptz;
ALTER TABLE "commons_file_record" ADD COLUMN IF NOT EXISTS "held_by"     text;
ALTER TABLE "commons_file_record" ADD COLUMN IF NOT EXISTS "hold_reason" text;

-- 5. Deleting a file keeps its access log — "who downloaded this" must outlive the file. The rows keep the
--    deleted file's id; nothing references it any more.
ALTER TABLE "commons_file_access" DROP CONSTRAINT IF EXISTS "commons_file_access_file_record_id_fkey";

-- 6. Indexes for the reads the console makes.
--    A tenant's inventory, newest first — the keyset (created_at, id) behind a tenant filter.
CREATE INDEX IF NOT EXISTS "commons_file_record_tenant_created_idx"
  ON "commons_file_record" ("tenant_id", "created_at" DESC, "id" DESC);
--    Everything one person uploaded.
CREATE INDEX IF NOT EXISTS "commons_file_record_uploaded_by_idx"
  ON "commons_file_record" ("uploaded_by", "created_at" DESC);
--    The retention run: files past their date, oldest first.
CREATE INDEX IF NOT EXISTS "commons_file_record_retain_until_idx"
  ON "commons_file_record" ("retain_until") WHERE "retain_until" IS NOT NULL;
--    Held files — a short list.
CREATE INDEX IF NOT EXISTS "commons_file_record_held_idx"
  ON "commons_file_record" ("held_at" DESC) WHERE "held_at" IS NOT NULL;
--    The unfiltered inventory keysets on (created_at, id); 0001's created_at index lacks the tie-break.
CREATE INDEX IF NOT EXISTS "commons_file_record_created_id_idx"
  ON "commons_file_record" ("created_at" DESC, "id" DESC);
DROP INDEX IF EXISTS "commons_file_record_created_at_idx";
