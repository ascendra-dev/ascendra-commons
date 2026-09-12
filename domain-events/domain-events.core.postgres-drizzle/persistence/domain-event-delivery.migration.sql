-- Reference migration for the domain-events pattern's delivery log
-- (PostgresEventDeliveryRecorder + PostgresEventDeliveryObservabilityService).
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `domainEventDeliveryTable` from
-- `domain-event-delivery.schema.ts` and let `drizzle-kit generate` produce it.
--
-- Keep in sync with `domain-event-delivery.schema.ts` and the INSERT in
-- `postgres-event-delivery-recorder.ts`.
--
-- DELIVERY ONLY — one row per emit()/emitCritical() call, never a listener's
-- own outcome. See `domain-events.core`'s README, "What this does and doesn't
-- observe."

CREATE TABLE IF NOT EXISTS "commons_domain_events_delivery" (
  "id"              bigserial   PRIMARY KEY,
  "application"     text        NOT NULL,
  "event_name"      text        NOT NULL,
  "method"          text        NOT NULL,
  "transport"       text        NOT NULL,
  "occurred_at"     timestamptz NOT NULL,
  "delivered_at"    timestamptz NOT NULL,
  "listener_count"  integer     NOT NULL,
  "status"          text        NOT NULL,
  "reason"          text,
  "correlation_id"  text
);

CREATE INDEX IF NOT EXISTS "commons_domain_events_delivery_event_time_idx"
  ON "commons_domain_events_delivery" ("application", "event_name", "delivered_at");

CREATE INDEX IF NOT EXISTS "commons_domain_events_delivery_status_idx"
  ON "commons_domain_events_delivery" ("application", "status", "delivered_at");

-- No UPDATE/DELETE grants are modelled here: deliveries are write-once by
-- construction of `EventDeliveryRecorder` (recordDelivery() only, no update
-- method) — the same posture `audit-logging` takes for its own write-once log.
