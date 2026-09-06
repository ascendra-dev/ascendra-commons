import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { JobRunOutcome } from '../../job-run-recorder.interface';
import { humanizeDuration, parseCadence, type ParsedCadence } from './cadence';
import type { JobRunRecord, JobStatus, RunHistoryPage, RunHistoryQuery } from './job-observability.types';
import type { SqlExecutor } from './sql-executor';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR, JOB_OBSERVABILITY_CADENCES } from './tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** How many recent runs per job `listJobStatus()` inspects — enough to find a recent success and infer a gap. */
const STATUS_RUNS_PER_JOB = 50;
/** A job is overdue once the gap since its last run exceeds its cadence by this factor — leaves slack for a slow run or a missed-then-caught fire. */
const OVERDUE_FACTOR = 1.5;
/** Minimum scheduled+non-failed runs needed before a cadence can be inferred from history. */
const MIN_RUNS_TO_INFER = 3;

const RUN_COLUMNS = sql`
  id, job_name, trigger, started_at, finished_at, outcome,
  items_due, items_processed, items_failed, failed_item_refs, error, correlation_id
`;

/**
 * Read-only reporting over the `commons_jobs_job_run` table for an admin UI — the drill-down
 * log (`getRunHistory`) and the jobs dashboard (`listJobStatus`). Both scoped to
 * one `application`. No write path; the adapter's `PostgresJobRunRecorder` owns
 * writes.
 */
@Injectable()
export class PostgresJobObservabilityService {
  private readonly cadences: Map<string, ParsedCadence>;

  constructor(
    @Inject(JOB_RUN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(JOB_RUN_APPLICATION_ID) private readonly application: string,
    @Inject(JOB_OBSERVABILITY_CADENCES) cadences: Record<string, string | number>,
  ) {
    this.cadences = new Map(Object.entries(cadences).map(([name, c]) => [name, parseCadence(c)]));
  }

  /** Recent runs, newest first, keyset-paginated. `nextCursor` present ⇒ more rows. */
  async getRunHistory(query: RunHistoryQuery = {}): Promise<RunHistoryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.jobName) conds.push(sql`job_name = ${query.jobName}`);
    if (query.outcome) conds.push(sql`outcome = ${query.outcome}`);
    if (query.correlationId) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`started_at >= ${query.since}`);
    if (query.until) conds.push(sql`started_at < ${query.until}`);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        sql`(started_at < ${cursor.startedAt} or (started_at = ${cursor.startedAt} and id < ${cursor.id}::bigint))`,
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
      return { runs, nextCursor: encodeCursor(runs[runs.length - 1]) };
    }
    return { runs: rows };
  }

  /** One row per job — every job that has ever run, plus every job with a declared cadence. */
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
      overdue = true; // a job we expect on a cadence that has never run once
    }

    return { name, lastRun, lastSuccessAt, consecutiveFailures, cadence, overdue, overdueBy };
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

function mapRow(row: Record<string, unknown>): JobRunRecord {
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
    error: row.error == null ? null : String(row.error),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function encodeCursor(run: JobRunRecord): string {
  return Buffer.from(`${run.startedAt.toISOString()}|${run.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { startedAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { startedAt: new Date(ts), id };
  } catch {
    return null;
  }
}
