-- Reference migration for the payment-gateway-adapter pattern's Postgres/Drizzle
-- adapter — two tables: the atomic dedup ledger and the full observability log.
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `webhookClaimTable` / `webhookEventTable`
-- from their own `.schema.ts` files and let `drizzle-kit generate` produce it.
--
-- Keep in sync with `webhook-claim.schema.ts` / `webhook-event.schema.ts` and
-- the INSERT column lists in `postgres-webhook-event-log.ts`.

CREATE TABLE IF NOT EXISTS "commons_payment_gateway_webhook_claim" (
  "application"        text        NOT NULL,
  "gateway"             text        NOT NULL,
  "gateway_reference"   text        NOT NULL,
  "status"              text        NOT NULL,
  "claimed_at"          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("application", "gateway", "gateway_reference", "status")
);

CREATE TABLE IF NOT EXISTS "commons_payment_gateway_webhook_event" (
  "id"                 bigserial   PRIMARY KEY,
  "application"        text        NOT NULL,
  "gateway"            text        NOT NULL,
  "gateway_reference"  text,
  "status"             text,
  "outcome"            text        NOT NULL,   -- 'applied' | 'duplicate' | 'ignored_backwards' | 'signature_invalid'
  "occurred_at"        timestamptz NOT NULL,
  "correlation_id"     text
);

CREATE INDEX IF NOT EXISTS "commons_payment_gateway_webhook_event_time_idx"
  ON "commons_payment_gateway_webhook_event" ("application", "occurred_at");

CREATE INDEX IF NOT EXISTS "commons_payment_gateway_webhook_event_outcome_idx"
  ON "commons_payment_gateway_webhook_event" ("application", "outcome", "occurred_at");

CREATE INDEX IF NOT EXISTS "commons_payment_gateway_webhook_event_reference_idx"
  ON "commons_payment_gateway_webhook_event" ("gateway", "gateway_reference");
