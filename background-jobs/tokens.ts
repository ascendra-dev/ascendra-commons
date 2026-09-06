/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/** The consumer's Drizzle db client, aliased in via BackgroundJobsModule.forRoot() — this library never provides its own. */
export const SQL_EXECUTOR = Symbol('SQL_EXECUTOR');

/** What IdempotentJobRunner actually depends on — bound to whichever AdvisoryLock implementation the app uses. */
export const ADVISORY_LOCK = Symbol('ADVISORY_LOCK');

/**
 * The JobRunRecorder IdempotentJobRunner writes each run's summary through.
 * BackgroundJobsModule.forRoot() binds this to NoopJobRunRecorder unless the
 * consumer passes jobRunRecorderToken (e.g. POSTGRES_JOB_RUN_RECORDER from
 * adapters/postgres-drizzle).
 */
export const JOB_RUN_RECORDER = Symbol('JOB_RUN_RECORDER');
