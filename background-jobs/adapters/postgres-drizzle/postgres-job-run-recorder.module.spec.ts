import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { BackgroundJobsModule } from '../../background-jobs.module';
import { IdempotentJobRunner } from '../../idempotent-job-runner.service';
import type { ScheduledJob } from '../../scheduled-job.interface';
import { PostgresJobRunRecorderModule } from './postgres-job-run-recorder.module';
import { JobRunPrunerModule } from './job-run-pruner.module';
import { JobRunPrunerJob } from './job-run-pruner.job';
import { POSTGRES_JOB_RUN_RECORDER } from './tokens';

const LOCK_DB = Symbol('LOCK_DB');
const APP_DB = Symbol('APP_DB');
const dialect = new PgDialect();

/** Lock connection: pg_try_advisory_lock / pg_advisory_unlock both succeed. */
@Module({
  providers: [
    {
      provide: LOCK_DB,
      useValue: { execute: vi.fn().mockResolvedValue({ rows: [{ acquired: true, released: true }] }) },
    },
  ],
  exports: [LOCK_DB],
})
class LockDbModule {}

function appDbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: APP_DB, useValue: { execute } }], exports: [APP_DB] })
  class AppDbModule {}
  return { AppDbModule, execute };
}

describe('PostgresJobRunRecorderModule wired into BackgroundJobsModule', () => {
  it('records each run through PostgresJobRunRecorder against the app db token, application stamped', async () => {
    const { AppDbModule, execute } = appDbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          sqlExecutorToken: LOCK_DB,
          imports: [
            LockDbModule,
            PostgresJobRunRecorderModule.forRoot({
              sqlExecutorToken: APP_DB,
              application: 'ascendra-erp',
              imports: [AppDbModule],
            }),
          ],
          jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,
        }),
      ],
    }).compile();

    const job: ScheduledJob<string> = {
      name: 'invoice-reminder',
      findDueItems: vi.fn().mockResolvedValue(['x']),
      processItem: vi.fn().mockResolvedValue(undefined),
    };
    await moduleRef.get(IdempotentJobRunner).run(job, { trigger: 'manual' });

    // The app-db executor was hit exactly once — the run-history INSERT (the lock ran on LOCK_DB).
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into job_run/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'invoice-reminder', 'manual']));
  });

  it('JobRunPrunerModule provides a JobRunPrunerJob bound to its application and retention', async () => {
    const { AppDbModule, execute } = appDbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        JobRunPrunerModule.forRoot({
          sqlExecutorToken: APP_DB,
          application: 'ascendra-pay',
          retentionDays: 14,
          imports: [AppDbModule],
        }),
      ],
    }).compile();

    const pruner = moduleRef.get(JobRunPrunerJob);
    const [cutoff] = await pruner.findDueItems();
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(13 * 86_400_000);

    await pruner.processItem(cutoff);
    const { params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(params).toContain('ascendra-pay');
  });
});
