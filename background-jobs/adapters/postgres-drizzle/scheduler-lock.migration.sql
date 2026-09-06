-- Reference migration for the background-jobs pattern's Postgres/Drizzle
-- lease-table lock (PostgresLeaseLock — an alternative to the core's
-- session-level PostgresAdvisoryLock).
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or export `schedulerLockTable` from
-- `scheduler-lock.schema.ts` and let `drizzle-kit generate` produce it.
--
-- Keep this in sync with `scheduler-lock.schema.ts` and the statements in
-- `postgres-lease-lock.ts` — the three describe one table.
--
-- `locked_until` is the lease: a holder that crashes without releasing lets the
-- row expire, and the next run claims it via the conditional upsert. The holder
-- renews `locked_until` on a heartbeat while its run is in progress.

CREATE TABLE IF NOT EXISTS "scheduler_lock" (
  "application"  text        NOT NULL,
  "lock_key"     text        NOT NULL,
  "holder"       text        NOT NULL,
  "acquired_at"  timestamptz NOT NULL DEFAULT now(),
  "locked_until" timestamptz NOT NULL,
  PRIMARY KEY ("application", "lock_key")
);
