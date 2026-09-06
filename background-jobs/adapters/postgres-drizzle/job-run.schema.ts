import { bigserial, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `job_run` table — one concrete Postgres/Drizzle shape of the
 * generic `JobRunSummary` (see `../../job-run-recorder.interface.ts`), plus
 * `application`. This is the single source of truth for the reference schema:
 * `PostgresJobRunRecorder` writes exactly these columns, and
 * `job-run.migration.sql` in this folder is the hand-kept DDL form of the same
 * table — keep the three in sync when changing any of them.
 *
 * A consuming project on Postgres/Drizzle can `export` this table from its own
 * schema barrel so `drizzle-kit` picks it up (instead of pasting the raw
 * migration), and reads its run-history admin screen through this typed table
 * — the adapter itself ships no read path. A project on a different stack
 * ignores this file and provides its own `JobRunRecorder`.
 *
 * `application` — which Ascendra app the row belongs to — is on every row and
 * in every read's `application = $1` filter, so the table stays correct
 * whether each app keeps its own database (the common case, one constant
 * value) or job-run history is ever consolidated into one shared operational
 * database (rows disambiguated). Stamped from
 * `PostgresJobRunRecorderModule.forRoot({ application })`. This is the
 * `MODULE-STANDARD.md` dimension-4 call made the same way `notification` and
 * `audit-logging` make it — carried now so a later consolidation needs no
 * backfill.
 */
export const jobRunTable = pgTable(
  'job_run',
  {
    /** Assigned by Postgres on insert — an append-only ordered log, never looked up by id from outside. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    jobName: text('job_name').notNull(),
    /** 'scheduled' | 'bootstrap' | 'manual' — see `JobRunTrigger`. */
    trigger: text('trigger').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** 'completed' | 'job_failed' — see `JobRunOutcome`. A run with itemsFailed > 0 is still 'completed'. */
    outcome: text('outcome').notNull(),
    itemsDue: integer('items_due').notNull(),
    itemsProcessed: integer('items_processed').notNull(),
    itemsFailed: integer('items_failed').notNull(),
    /** describeItem() output for the items that failed this run, capped by the runner. A diagnosis sample. */
    failedItemRefs: text('failed_item_refs').array().notNull().default([]),
    /** Nullable — the job-level error's stack, present only when outcome = 'job_failed'. */
    error: text('error'),
  },
  (t) => ({
    /** "this application's runs of this job" — the run-history admin screen's main query, and the pruner's scan. */
    byApplicationJobTime: index('job_run_application_job_time_idx').on(t.application, t.jobName, t.startedAt),
  }),
);
