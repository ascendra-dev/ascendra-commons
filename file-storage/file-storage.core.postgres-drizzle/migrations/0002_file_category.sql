-- file-storage · the file category catalog.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/file-category.schema.ts` and the catalog's SQL.
--
-- Requires PostgreSQL 15+ (partial unique indexes below need no special feature, but the
-- category catalog assumes a modern Postgres elsewhere).

CREATE TABLE IF NOT EXISTS "commons_file_category" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"                        text NOT NULL,
  "tenant_id"                  uuid,                       -- NULL = base definition; non-NULL = a tenant override

  -- base-only
  "label"                      text,
  "description"                text,
  "bucket"                     text,
  "retention"                  jsonb,                      -- { "keepForDays": N } | "indefinite"

  -- base default + tenant override (a set override value must be no less restrictive than the base)
  "allowed_content_types"      text[],
  "max_size_bytes"             bigint,
  "min_size_bytes"             bigint,
  "allowed_extensions"         text[],
  "on_unscannable"             text,                       -- 'reject' | 'allow'
  "signed_link_expiry_seconds" integer,

  "active"                     boolean NOT NULL DEFAULT true,
  "source"                     text NOT NULL,              -- 'seed' | 'platform' | 'tenant'
  "created_at"                 timestamptz NOT NULL DEFAULT now(),
  "updated_at"                 timestamptz NOT NULL DEFAULT now()
);

-- One base row per key; one override row per (key, tenant).
CREATE UNIQUE INDEX IF NOT EXISTS "commons_file_category_base_uq"
  ON "commons_file_category" ("key") WHERE "tenant_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "commons_file_category_tenant_uq"
  ON "commons_file_category" ("key", "tenant_id") WHERE "tenant_id" IS NOT NULL;
