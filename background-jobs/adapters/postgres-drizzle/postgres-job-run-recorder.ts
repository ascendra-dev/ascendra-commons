import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { JobRunRecorder, JobRunSummary } from '../../job-run-recorder.interface';
import type { SqlExecutor } from './sql-executor';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR } from './tokens';

/**
 * Reference `JobRunRecorder` for Postgres via Drizzle — one library-owned
 * `INSERT`, `application` stamped on write, no project-specific logic. The same
 * shape `PostgresAdvisoryLock` and `audit-logging`'s reference repository take.
 * A consumer on this stack wires it through `PostgresJobRunRecorderModule` and
 * writes none of this; a consumer on a different stack provides its own
 * `JobRunRecorder`.
 *
 * Corresponding table: `job-run.schema.ts` / `job-run.migration.sql` in this
 * folder — the column list below is the third copy of that one table; keep the
 * three in sync.
 *
 * Honors `JobRunRecorder`'s best-effort contract itself: a write failure is
 * logged and swallowed, never propagated. `IdempotentJobRunner` also guards the
 * call — this is the belt-and-braces, so a consumer wiring the recorder
 * somewhere else still can't turn a telemetry failure into a job failure.
 */
@Injectable()
export class PostgresJobRunRecorder implements JobRunRecorder {
  private readonly logger = new Logger(PostgresJobRunRecorder.name);

  constructor(
    @Inject(JOB_RUN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(JOB_RUN_APPLICATION_ID) private readonly application: string,
  ) {}

  async recordRun(summary: JobRunSummary): Promise<void> {
    try {
      await this.db.execute(sql`
        insert into commons_jobs_job_run (
          application, job_name, trigger, started_at, finished_at,
          outcome, items_due, items_processed, items_failed, failed_item_refs, error, correlation_id
        ) values (
          ${this.application}, ${summary.jobName}, ${summary.trigger}, ${summary.startedAt}, ${summary.finishedAt},
          ${summary.outcome}, ${summary.itemsDue}, ${summary.itemsProcessed}, ${summary.itemsFailed},
          ${this.textArray(summary.failedItemRefs)}, ${summary.error ?? null}, ${summary.correlationId ?? null}
        )
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record run of job "${summary.jobName}" (${summary.outcome}) — job outcome is unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Bind a JS string[] as a real text[] — each element a parameter, never string-interpolated. */
  private textArray(values: string[]): SQL {
    if (values.length === 0) return sql`'{}'::text[]`;
    return sql`array[${sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    )}]::text[]`;
  }
}
