import { DynamicModule, Module } from '@nestjs/common';
import { PostgresJobStatusService } from './job-status.service';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR, JOB_STATUS_CADENCES } from './tokens';

export interface PostgresJobStatusModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Which Ascendra application this process is — every query is scoped to it. */
  application: string;

  /**
   * Optional per-job cadence hint — a rough "if it hasn't run in this long,
   * something is wrong" bound, **not** the real cron (the adapter never sees
   * `@Cron`). `'1d'` / `'2h'` / `'30m'` / `'90s'`, or a number of seconds. Keep
   * it loosely in step with the job's `@Cron` (a daily job → `'1d'`). Keys also
   * seed the dashboard's job list, so a declared-but-never-run job still shows
   * (as overdue). A job with no entry gets an `overdue` verdict only if a
   * cadence can be inferred from its own scheduled-run history; otherwise its
   * row shows history without a badge. A bad value throws at startup.
   */
  cadences?: Record<string, string | number>;

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_jobs_job_run` for an admin UI: `getRunHistory()` (the
 * drill-down log) and `listJobStatus()` (the jobs dashboard, with overdue
 * detection). Exports `PostgresJobStatusService`; the consumer writes the
 * controller and gates it with their own `Authorizer`.
 */
@Module({})
export class PostgresJobStatusModule {
  static forRoot(config: PostgresJobStatusModuleConfig): DynamicModule {
    return {
      module: PostgresJobStatusModule,
      imports: config.imports ?? [],
      providers: [
        { provide: JOB_RUN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: JOB_RUN_APPLICATION_ID, useValue: config.application },
        { provide: JOB_STATUS_CADENCES, useValue: config.cadences ?? {} },
        PostgresJobStatusService,
      ],
      exports: [PostgresJobStatusService],
    };
  }
}
