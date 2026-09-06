-- Reference migration for the background-jobs pattern's Postgres/Drizzle adapter.
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7 — the DB instance and its migration history are
-- always consumer-owned). Copy this statement into the consuming project's own
-- migration tooling, or export `jobRunTable` from `job-run.schema.ts` and let
-- `drizzle-kit generate` produce the equivalent.
--
-- Keep this in sync with `job-run.schema.ts` and the INSERT column list in
-- `postgres-job-run-recorder.ts` — the three describe one table.
--
-- `application` = which Ascendra app the row belongs to. Constant within one
-- app's own database; the column and every read's `application = $1` filter (and
-- JobRunPrunerJob's DELETE) keep this table correct if job-run history is ever
-- consolidated into one shared operational database. Stamped from
-- PostgresJobRunRecorderModule.forRoot({ application }).

CREATE TABLE IF NOT EXISTS "commons_jobs_job_run" (
  "id"               bigserial   PRIMARY KEY,
  "application"      text        NOT NULL,
  "job_name"         text        NOT NULL,
  "trigger"          text        NOT NULL,
  "started_at"       timestamptz NOT NULL,
  "finished_at"      timestamptz NOT NULL,
  "outcome"          text        NOT NULL,
  "items_due"        integer     NOT NULL,
  "items_processed"  integer     NOT NULL,
  "items_failed"     integer     NOT NULL,
  "failed_item_refs" text[]      NOT NULL DEFAULT '{}',
  "error"            text,
  "correlation_id"   text
);

-- "this application's runs of this job" — the run-history admin screen's main
-- query, and the scan JobRunPrunerJob's DELETE uses.
CREATE INDEX IF NOT EXISTS "commons_jobs_job_run_application_job_time_idx"
  ON "commons_jobs_job_run" ("application", "job_name", "started_at");
