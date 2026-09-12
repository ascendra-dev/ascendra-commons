-- Reference migration for the idempotency-key pattern's Postgres/Drizzle adapter (Model 1).
--
-- This library never runs migrations against a consumer's database
-- (MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `idempotencyKeyTable` from `idempotency-key.schema.ts`
-- and let `drizzle-kit generate` produce the equivalent. Keep the three in sync
-- (schema, this file, the store's SQL).
--
-- reclaim_count / late_complete_no_op_count / correlation_id added 2026-09-12
-- (observability pass) — if a project already ran the pre-2026-09-12 form of
-- this table, add the three columns with an ALTER TABLE instead of re-running this.

CREATE TABLE IF NOT EXISTS "commons_idempotency_key" (
  "key"                       text NOT NULL,
  "scope"                     text NOT NULL,
  "status"                    text NOT NULL DEFAULT 'pending',   -- 'pending' | 'completed'
  "claim_id"                  uuid NOT NULL,                     -- current owner's attempt token; complete() is guarded on it
  "status_code"               integer,
  "response_body"             jsonb,
  "created_at"                timestamptz NOT NULL DEFAULT now(),
  "reclaim_count"             integer NOT NULL DEFAULT 0,        -- incremented atomically on every stale reclaim
  "late_complete_no_op_count" integer NOT NULL DEFAULT 0,        -- a dropped complete() — an unambiguous duplicate-processing count
  "correlation_id"            text,
  PRIMARY KEY ("key", "scope")
);

-- Cleanup is a bare @Cron() DELETE FROM commons_idempotency_key WHERE created_at < now() - interval '24 hours'
-- (safe under concurrent execution — Postgres serializes it). This index keeps that DELETE off a full scan;
-- it also backs listClaims()'s default newest-first order and claimHealthSummary()'s "oldest retained" lookup.
CREATE INDEX IF NOT EXISTS "commons_idempotency_key_created_at_idx"
  ON "commons_idempotency_key" ("created_at");

-- listClaims({ status }) — the support-screen filter for "show me what's stuck pending".
CREATE INDEX IF NOT EXISTS "commons_idempotency_key_status_idx"
  ON "commons_idempotency_key" ("status", "created_at");

-- listClaims({ correlationId }) — cross-module trace lookup.
CREATE INDEX IF NOT EXISTS "commons_idempotency_key_correlation_idx"
  ON "commons_idempotency_key" ("correlation_id");
