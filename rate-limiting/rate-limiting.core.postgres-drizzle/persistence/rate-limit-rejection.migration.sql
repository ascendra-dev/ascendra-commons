-- Reference migration for the rate-limiting pattern's Postgres/Drizzle adapter.
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `rateLimitRejectionTable` from
-- `rate-limit-rejection.schema.ts` and let `drizzle-kit generate` produce it.
--
-- Keep in sync with `rate-limit-rejection.schema.ts` and the INSERT column
-- list in `postgres-rate-limit-event-recorder.ts`.

CREATE TABLE IF NOT EXISTS "commons_rate_limit_rejection" (
  "id"              bigserial   PRIMARY KEY,
  "application"     text        NOT NULL,
  "route"           text        NOT NULL,
  "identifier"      text        NOT NULL,
  "limit"           integer     NOT NULL,
  "ttl_ms"          integer     NOT NULL,
  "rejected_at"     timestamptz NOT NULL,
  "correlation_id"  text
);

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_time_idx"
  ON "commons_rate_limit_rejection" ("application", "rejected_at");

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_route_idx"
  ON "commons_rate_limit_rejection" ("application", "route", "rejected_at");

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_identifier_idx"
  ON "commons_rate_limit_rejection" ("identifier", "rejected_at");
