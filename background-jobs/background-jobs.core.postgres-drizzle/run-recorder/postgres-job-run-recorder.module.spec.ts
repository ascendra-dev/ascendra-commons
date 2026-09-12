import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { BackgroundJobsModule, IdempotentJobRunner } from '../../background-jobs.core';
import type { ScheduledJob } from '../../background-jobs.core';
import { PostgresLeaseLockModule } from '../lock/postgres-lease-lock.module';
import { POSTGRES_LEASE_LOCK } from '../tokens';
import { PostgresJobRunRecorderModule } from './postgres-job-run-recorder.module';
import { JobRunPrunerModule } from '../pruner/job-run-pruner.module';
import { JobRunPrunerJob } from '../pruner/job-run-pruner.job';
import { POSTGRES_JOB_RUN_RECORDER } from '../tokens';

const LOCK_DB = Symbol('LOCK_DB');
const APP_DB = Symbol('APP_DB');
const dialect = new PgDialect();

function lockDbModule() {
  const execute = vi.fn(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (/insert into commons_jobs_lock/i.test(text)) return { rows: [{ holder: params[2] }] };
    return { rows: [{ lock_key: 'k' }] };
  });
  @Module({ providers: [{ provide: LOCK_DB, useValue: { execute } }], exports: [LOCK_DB] })
  class LockDbModule {}
  return { LockDbModule };
}

function appDbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: APP_DB, useValue: { execute } }], exports: [APP_DB] })
  class AppDbModule {}
  return { AppDbModule, execute };
}

describe('PostgresJobRunRecorderModule wired into BackgroundJobsModule', () => {
  it('records each run through PostgresJobRunRecorder against the app db token, application stamped', async () => {
    const { LockDbModule } = lockDbModule();
    const { AppDbModule, execute } = appDbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          advisoryLockToken: POSTGRES_LEASE_LOCK,
          jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,
          imports: [
            PostgresLeaseLockModule.forRoot({ sqlExecutorToken: LOCK_DB, application: 'ascendra-erp', imports: [LockDbModule] }),
            PostgresJobRunRecorderModule.forRoot({ sqlExecutorToken: APP_DB, application: 'ascendra-erp', imports: [AppDbModule] }),
          ],
        }),
      ],
    }).compile();

    const job: ScheduledJob<string> = {
      name: 'invoice-reminder',
      findDueItems: vi.fn().mockResolvedValue(['x']),
      processItem: vi.fn().mockResolvedValue(undefined),
    };
    await moduleRef.get(IdempotentJobRunner).run(job, { trigger: 'manual' });
    await moduleRef.close();

    // The app-db executor was hit exactly once — the run-history INSERT (the lock ran on LOCK_DB).
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/insert into commons_jobs_job_run/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'invoice-reminder', 'manual']));
  });

  it('JobRunPrunerModule provides a JobRunPrunerJob bound to its application and retention', async () => {
    const { AppDbModule, execute } = appDbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        JobRunPrunerModule.forRoot({ sqlExecutorToken: APP_DB, application: 'ascendra-pay', retentionDays: 14, imports: [AppDbModule] }),
      ],
    }).compile();

    const pruner = moduleRef.get(JobRunPrunerJob);
    const [cutoff] = await pruner.findDueItems();
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(13 * 86_400_000);

    await pruner.processItem(cutoff);
    expect(dialect.sqlToQuery(execute.mock.calls[0][0] as SQL).params).toContain('ascendra-pay');
  });
});
