import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  humanizeDuration,
  parseCadence,
  type FailedItemSummary,
  type JobObservabilityPort,
  type JobRunOutcome,
  type JobRunRecord,
  type JobStatus,
  type ParsedCadence,
  type RunHistoryPage,
  type RunHistoryQuery,
} from '../../background-jobs.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { JOB_OBSERVABILITY_CADENCES, JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** How many recent runs per job `listJobStatus()` inspects. */
const STATUS_RUNS_PER_JOB = 50;
/** A job is overdue once the gap since its last run exceeds its cadence by this factor. */
const OVERDUE_FACTOR = 1.5;
/** Minimum scheduled+non-failed runs needed before a cadence can be inferred from history. */
const MIN_RUNS_TO_INFER = 3;
/**
 * List rows (`getRunHistory` / `listJobStatus`) truncate `error` to this many
 * characters — the full stack trace on every list row was an unintended
 * info-leak risk, not just a payload-size concern. The untruncated stack is
 * available via `getRun`.
 */
const ERROR_TRUNCATE_LENGTH = 500;
/** How many of a job's most recent runs `getFailedItems` scans for recurring refs. */
const FAILED_ITEMS_RUN_WINDOW = 50;
/** Default "recurs in at least this many of the scanned runs" bar for `getFailedItems`. */
const DEFAULT_MIN_FAILED_RUNS = 2;

const RUN_COLUMNS = sql`
  id, job_name, trigger, started_at, finished_at, outcome,
  items_due, items_processed, items_failed, failed_item_refs, error, correlation_id
`;

/**
 * `JobObservabilityPort` for Postgres/Drizzle — read-only reporting over
 * `commons_jobs_job_run`. Both reads `application`-scoped. No write path; the
 * adapter's `PostgresJobRunRecorder` owns writes.
 */
@Injectable()
export class PostgresJobObservabilityService implements JobObservabilityPort {
  private readonly cadences: Map<string, ParsedCadence>;

  constructor(
    @Inject(JOB_RUN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(JOB_RUN_APPLICATION_ID) private readonly application: string,
    @Inject(JOB_OBSERVABILITY_CADENCES) cadences: Record<string, string | number>,
  ) {
    this.cadences = new Map(Object.entries(cadences).map(([name, c]) => [name, parseCadence(c)]));
  }

  async getRunHistory(query: RunHistoryQuery = {}): Promise<RunHistoryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.jobName) conds.push(sql`job_name = ${query.jobName}`);
    if (query.outcome) conds.push(sql`outcome = ${query.outcome}`);
    if (query.correlationId) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`started_at >= ${query.since}`);
    if (query.until) conds.push(sql`started_at < ${query.until}`);
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        sql`(started_at < ${cursor.timestamp} or (started_at = ${cursor.timestamp} and id < ${cursor.id}::bigint))`,
      );
    }

    const rows = (
      await this.db.execute(sql`
        select ${RUN_COLUMNS} from commons_jobs_job_run
        where ${sql.join(conds, sql` and `)}
        order by started_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const runs = rows.slice(0, limit);
      const last = runs[runs.length - 1];
      return { runs, nextCursor: encodeKeysetCursor(last.startedAt, last.id) };
    }
    return { runs: rows };
  }

  async listJobStatus(): Promise<JobStatus[]> {
    const rows = (
      await this.db.execute(sql`
        select ${RUN_COLUMNS} from (
          select *, row_number() over (partition by job_name order by started_at desc) as rn
          from commons_jobs_job_run
          where application = ${this.application}
        ) ranked
        where rn <= ${STATUS_RUNS_PER_JOB}
        order by job_name, started_at desc
      `)
    ).rows.map(mapRow);

    const byJob = new Map<string, JobRunRecord[]>();
    for (const run of rows) {
      const list = byJob.get(run.jobName);
      if (list) list.push(run);
      else byJob.set(run.jobName, [run]);
    }
    for (const name of this.cadences.keys()) if (!byJob.has(name)) byJob.set(name, []);

    const now = Date.now();
    return [...byJob.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, runs]) => this.toStatus(name, runs, now));
  }

  private toStatus(name: string, runs: JobRunRecord[], now: number): JobStatus {
    const lastRun = runs[0] ?? null;
    const lastSuccessAt = runs.find((r) => r.outcome === 'completed' && r.itemsFailed === 0)?.startedAt ?? null;

    let consecutiveFailures = 0;
    for (const run of runs) {
      if (run.outcome === 'job_failed' || run.itemsFailed > 0) consecutiveFailures++;
      else break;
    }

    const cadence = this.cadenceFor(name, runs);
    let overdue = false;
    let overdueBy: string | null = null;
    if (cadence && lastRun) {
      const gapSeconds = (now - lastRun.startedAt.getTime()) / 1000;
      if (gapSeconds > cadence.seconds * OVERDUE_FACTOR) {
        overdue = true;
        overdueBy = humanizeDuration(gapSeconds - cadence.seconds);
      }
    } else if (cadence && !lastRun) {
      overdue = true;
    }

    return { name, lastRun, lastSuccessAt, consecutiveFailures, cadence, overdue, overdueBy };
  }

  async getRun(id: string): Promise<JobRunRecord | null> {
    const { rows } = await this.db.execute(sql`
      select ${RUN_COLUMNS} from commons_jobs_job_run
      where application = ${this.application} and id = ${id}::bigint
    `);
    const row = rows[0];
    return row ? mapRunDetail(row) : null;
  }

  async getFailedItems(jobName: string, minRuns = DEFAULT_MIN_FAILED_RUNS): Promise<FailedItemSummary[]> {
    const rows = (
      await this.db.execute(sql`
        with recent_runs as (
          select started_at, failed_item_refs
          from commons_jobs_job_run
          where application = ${this.application} and job_name = ${jobName}
          order by started_at desc
          limit ${FAILED_ITEMS_RUN_WINDOW}
        )
        select ref as item_ref, count(*)::int as failure_count, max(started_at) as last_failed_at
        from recent_runs, unnest(failed_item_refs) as ref
        group by ref
        having count(*) >= ${minRuns}
        order by failure_count desc, last_failed_at desc
      `)
    ).rows;

    return rows.map((row) => ({
      itemRef: String(row.item_ref),
      failureCount: Number(row.failure_count),
      lastFailedAt: asDate(row.last_failed_at),
    }));
  }

  private cadenceFor(name: string, runs: JobRunRecord[]): JobStatus['cadence'] {
    const declared = this.cadences.get(name);
    if (declared) return { source: 'declared', seconds: declared.seconds, label: declared.label };

    const scheduledTimes = runs
      .filter((r) => r.trigger === 'scheduled' && r.outcome !== 'job_failed')
      .map((r) => r.startedAt.getTime())
      .sort((a, b) => a - b);
    if (scheduledTimes.length < MIN_RUNS_TO_INFER) return null;

    const gaps: number[] = [];
    for (let i = 1; i < scheduledTimes.length; i++) gaps.push((scheduledTimes[i] - scheduledTimes[i - 1]) / 1000);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    return { source: 'inferred', seconds: Math.round(median), label: humanizeDuration(median) };
  }
}

function mapRowBase(row: Record<string, unknown>): Omit<JobRunRecord, 'error'> {
  return {
    id: String(row.id),
    jobName: String(row.job_name),
    trigger: String(row.trigger) as JobRunRecord['trigger'],
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
    outcome: String(row.outcome) as JobRunOutcome,
    itemsDue: Number(row.items_due),
    itemsProcessed: Number(row.items_processed),
    itemsFailed: Number(row.items_failed),
    failedItemRefs: Array.isArray(row.failed_item_refs) ? row.failed_item_refs.map(String) : [],
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}

/** List-row projection (`getRunHistory` / `listJobStatus`) — `error` truncated. Full stack: `getRun`. */
function mapRow(row: Record<string, unknown>): JobRunRecord {
  return { ...mapRowBase(row), error: truncateError(row.error == null ? null : String(row.error)) };
}

/** Single-run projection (`getRun`) — full, untruncated `error` stack. */
function mapRunDetail(row: Record<string, unknown>): JobRunRecord {
  return { ...mapRowBase(row), error: row.error == null ? null : String(row.error) };
}

function truncateError(error: string | null): string | null {
  if (error == null || error.length <= ERROR_TRUNCATE_LENGTH) return error;
  return `${error.slice(0, ERROR_TRUNCATE_LENGTH)}… (truncated — see GET /jobs/runs/:id for the full stack)`;
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
