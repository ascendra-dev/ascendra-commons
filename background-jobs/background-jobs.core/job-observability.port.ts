import type { JobStatus, RunHistoryPage, RunHistoryQuery } from './job-observability.types';

/**
 * Read-only reporting over job-run history for an admin screen — the run
 * drill-down log (`getRunHistory`) and the jobs dashboard (`listJobStatus`,
 * with overdue detection). Bound under `JOB_OBSERVABILITY_PORT` by a stack
 * adapter; consumed by `background-jobs.api`. Never mutates — `JobRunRecorder`
 * owns writes.
 *
 * "Missed schedule" is not stored (you can't write a row for a run that never
 * happened) — it's *derived* in `listJobStatus` from a per-job cadence hint.
 */
export interface JobObservabilityPort {
  /** Recent runs, newest first, keyset-paginated. */
  getRunHistory(query?: RunHistoryQuery): Promise<RunHistoryPage>;
  /** One row per job — every job that has ever run, plus every job with a declared cadence. */
  listJobStatus(): Promise<JobStatus[]>;
}
