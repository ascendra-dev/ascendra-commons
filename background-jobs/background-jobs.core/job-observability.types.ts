import type { JobRunOutcome, JobRunTrigger } from './job-run-recorder.port';

/** One `commons_jobs_job_run` row, mapped and typed — what a run-history UI table renders. */
export interface JobRunRecord {
  /** The `bigserial` id as a string (Postgres returns bigint as text to avoid precision loss). */
  id: string;
  jobName: string;
  trigger: JobRunTrigger;
  startedAt: Date;
  finishedAt: Date;
  outcome: JobRunOutcome;
  itemsDue: number;
  itemsProcessed: number;
  itemsFailed: number;
  failedItemRefs: string[];
  error: string | null;
  /** The request/trace id this run belonged to, when a manual run supplied one. */
  correlationId: string | null;
}

export interface RunHistoryQuery {
  /** One job's history; omit for all jobs interleaved, newest first. */
  jobName?: string;
  outcome?: JobRunOutcome;
  /** Join a run to the same id in audit / notification-delivery for a cross-module trace. */
  correlationId?: string;
  /** Inclusive lower bound on `startedAt`. */
  since?: Date;
  /** Exclusive upper bound on `startedAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface RunHistoryPage {
  runs: JobRunRecord[];
  /** Present when more rows match — pass back as `RunHistoryQuery.cursor`. */
  nextCursor?: string;
}

export interface JobCadenceView {
  /** `'declared'` = from `forRoot({ cadences })`; `'inferred'` = median gap of recent scheduled runs. */
  source: 'declared' | 'inferred';
  seconds: number;
  /** Human form, e.g. "1 day". */
  label: string;
}

/** One row of the jobs dashboard. */
export interface JobStatus {
  name: string;
  /** The most recent run, or `null` if the job has never run. */
  lastRun: JobRunRecord | null;
  /** The most recent fully-clean run (`completed`, `itemsFailed === 0`), or `null`. */
  lastSuccessAt: Date | null;
  /** Most-recent consecutive runs that were `job_failed` or `completed` with `itemsFailed > 0`. */
  consecutiveFailures: number;
  /** `null` when no cadence was declared and none could be inferred from history. */
  cadence: JobCadenceView | null;
  /** True only when a cadence is known and the gap since `lastRun` exceeds it by the overdue factor (1.5×), or a declared-cadence job has never run. */
  overdue: boolean;
  /** Human form, e.g. "2 days" — how far past the expected cadence, or `null`. */
  overdueBy: string | null;
}
