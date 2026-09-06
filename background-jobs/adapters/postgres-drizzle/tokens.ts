/**
 * Injection tokens for the Postgres/Drizzle adapter. Symbols, not string
 * literals — same reasoning as the rest of this library (a typo in a binding
 * is a compile error, not a silently unbound provider). Module-prefixed
 * (`JOB_RUN_`) so they never collide with the core's `SQL_EXECUTOR`, which
 * after Option D must be a dedicated single connection — the recorder and
 * pruner deliberately use a *separate*, normally-pooled connection.
 */

/** The consumer's Drizzle db, aliased in via the adapter modules' `forRoot({ sqlExecutorToken })`. */
export const JOB_RUN_SQL_EXECUTOR = Symbol('JOB_RUN_SQL_EXECUTOR');

/**
 * Which Ascendra application this process is (e.g. `'ascendra-pay'`) — stamped
 * into every `job_run` row's `application` column, and the `application = $1`
 * filter on every read and on the pruner's DELETE. A plain value from
 * `forRoot({ application })`, not `domain-events`' `DOMAIN_EVENTS_APPLICATION_ID`
 * token, so the adapter works whether or not that token is bound.
 */
export const JOB_RUN_APPLICATION_ID = Symbol('JOB_RUN_APPLICATION_ID');

/** How many days of `job_run` history `JobRunPrunerJob` keeps — from `JobRunPrunerModule.forRoot({ retentionDays })`. */
export const JOB_RUN_RETENTION_DAYS = Symbol('JOB_RUN_RETENTION_DAYS');

/**
 * What `PostgresJobRunRecorderModule` exports — pass this as
 * `BackgroundJobsModule.forRoot({ jobRunRecorderToken })`, with the recorder
 * module in that same call's `imports`.
 */
export const POSTGRES_JOB_RUN_RECORDER = Symbol('POSTGRES_JOB_RUN_RECORDER');
