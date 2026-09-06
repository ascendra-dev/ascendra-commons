-- Reference migration for the idempotency-key pattern's Postgres/Drizzle adapter (Model 1).
--
-- This library never runs migrations against a consumer's database
-- (MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `idempotencyKeyTable` from `idempotency-key.schema.ts`
-- and let `drizzle-kit generate` produce the equivalent. Keep the three in sync
-- (schema, this file, the store's SQL).

CREATE TABLE IF NOT EXISTS "commons_idempotency_key" (
  "key"           text NOT NULL,
  "scope"         text NOT NULL,
  "status"        text NOT NULL DEFAULT 'pending',   -- 'pending' | 'completed'
  "claim_id"      uuid NOT NULL,                     -- current owner's attempt token; complete() is guarded on it
  "status_code"   integer,
  "response_body" jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("key", "scope")
);

-- Cleanup is a bare @Cron() DELETE FROM commons_idempotency_key WHERE created_at < now() - interval '24 hours'
-- (safe under concurrent execution — Postgres serializes it). This index keeps that DELETE off a full scan.
CREATE INDEX IF NOT EXISTS "commons_idempotency_key_created_at_idx"
  ON "commons_idempotency_key" ("created_at");
