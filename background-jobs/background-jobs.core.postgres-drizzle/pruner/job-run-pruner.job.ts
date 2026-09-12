import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ScheduledJob } from '../../background-jobs.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_RETENTION_DAYS, JOB_RUN_SQL_EXECUTOR } from '../tokens';

/**
 * Reference `ScheduledJob` that keeps `commons_jobs_job_run` from growing forever — the
 * module dogfooding its own interface. One item per run: the cutoff date.
 * `processItem` deletes this application's `commons_jobs_job_run` rows older than it.
 *
 * `commons_jobs_job_run` retention is consumer-owned (MODULE-STANDARD.md dimension 7) — this
 * is a ready-made way to own it, not something the adapter runs on its own. Wire
 * it through `JobRunPrunerModule` and give it a cadence with a schedule class
 * (see the adapter README); a consumer who prunes another way ignores it.
 *
 * The DELETE is `application`-qualified — in a shared operational database it
 * never touches another app's history.
 */
@Injectable()
export class JobRunPrunerJob implements ScheduledJob<Date> {
  readonly name = 'job-run-pruner';

  constructor(
    @Inject(JOB_RUN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(JOB_RUN_APPLICATION_ID) private readonly application: string,
    @Inject(JOB_RUN_RETENTION_DAYS) private readonly retentionDays: number,
  ) {}

  async findDueItems(): Promise<Date[]> {
    return [new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000)];
  }

  async processItem(cutoff: Date): Promise<void> {
    await this.db.execute(
      sql`delete from commons_jobs_job_run where application = ${this.application} and started_at < ${cutoff}`,
    );
  }

  describeItem(cutoff: Date): string {
    return `commons_jobs_job_run rows before ${cutoff.toISOString()} for "${this.application}"`;
  }
}
