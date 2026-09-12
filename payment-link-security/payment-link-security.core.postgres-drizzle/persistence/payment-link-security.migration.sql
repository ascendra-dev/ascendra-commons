-- Reference migration for the payment-link-security pattern's Postgres/Drizzle
-- adapter — two tables: the token store and the resolution log.
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `paymentLinkTokenTable` /
-- `paymentLinkResolutionTable` from their own `.schema.ts` files and let
-- `drizzle-kit generate` produce the equivalent.
--
-- Keep in sync with `payment-link-token.schema.ts` / `payment-link-resolution.schema.ts`
-- and the INSERT/UPDATE column lists in `postgres-payment-link-token-service.ts`
-- and `postgres-token-resolution-recorder.ts`.

CREATE TABLE IF NOT EXISTS "commons_payment_link_token" (
  "id"           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "application"  text        NOT NULL,
  "token_hash"   text        NOT NULL UNIQUE,   -- SHA-256 hex of the raw token — never the raw value at rest
  "resource_id"  text        NOT NULL,
  "subject_id"   text        NOT NULL,
  "revoked_at"   timestamptz,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commons_payment_link_token_resource_idx"
  ON "commons_payment_link_token" ("application", "resource_id");

CREATE TABLE IF NOT EXISTS "commons_payment_link_resolution" (
  "id"              bigserial   PRIMARY KEY,
  "application"     text        NOT NULL,
  "token_hash"      text        NOT NULL,
  "outcome"         text        NOT NULL,        -- 'resolved' | 'not_found' | 'revoked'
  "attempted_at"    timestamptz NOT NULL,
  "correlation_id"  text
);

CREATE INDEX IF NOT EXISTS "commons_payment_link_resolution_time_idx"
  ON "commons_payment_link_resolution" ("application", "attempted_at");

CREATE INDEX IF NOT EXISTS "commons_payment_link_resolution_token_hash_idx"
  ON "commons_payment_link_resolution" ("token_hash");

CREATE INDEX IF NOT EXISTS "commons_payment_link_resolution_outcome_idx"
  ON "commons_payment_link_resolution" ("application", "outcome", "attempted_at");
