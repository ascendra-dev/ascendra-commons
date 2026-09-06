import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { BackgroundJobsModule } from '../../background-jobs.module';
import { IdempotentJobRunner } from '../../idempotent-job-runner.service';
import type { ScheduledJob } from '../../scheduled-job.interface';
import { PostgresLeaseLockModule } from './postgres-lease-lock.module';
import { POSTGRES_LEASE_LOCK } from './tokens';

const LOCK_DB = Symbol('LOCK_DB');
const dialect = new PgDialect();

function lockDbModule() {
  const execute = vi.fn().mockImplementation(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (/insert into commons_jobs_lock/i.test(text)) return { rows: [{ holder: params[2] }] };
    return { rows: [{ lock_key: 'k' }] };
  });
  @Module({ providers: [{ provide: LOCK_DB, useValue: { execute } }], exports: [LOCK_DB] })
  class LockDbModule {}
  return { LockDbModule, execute };
}

describe('PostgresLeaseLockModule wired into BackgroundJobsModule via advisoryLockToken', () => {
  it('runs a job through the lease lock — no sqlExecutorToken needed', async () => {
    const { LockDbModule, execute } = lockDbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          advisoryLockToken: POSTGRES_LEASE_LOCK,
          imports: [
            PostgresLeaseLockModule.forRoot({
              sqlExecutorToken: LOCK_DB,
              application: 'ascendra-pay',
              leaseSeconds: 60,
              imports: [LockDbModule],
            }),
          ],
        }),
      ],
    }).compile();

    const job: ScheduledJob<string> = {
      name: 'invoice-reminder',
      findDueItems: vi.fn().mockResolvedValue(['x']),
      processItem: vi.fn().mockResolvedValue(undefined),
    };
    await moduleRef.get(IdempotentJobRunner).run(job);
    await moduleRef.close(); // triggers onModuleDestroy → clears the heartbeat

    expect(job.processItem).toHaveBeenCalledWith('x');
    const claimCall = execute.mock.calls.find((c) => /insert into commons_jobs_lock/i.test(dialect.sqlToQuery(c[0] as SQL).sql));
    expect(claimCall).toBeDefined();
    const releaseCall = execute.mock.calls.find((c) => /delete from commons_jobs_lock/i.test(dialect.sqlToQuery(c[0] as SQL).sql));
    expect(releaseCall).toBeDefined();
  });

  it('forRoot throws when neither sqlExecutorToken nor advisoryLockToken is given', () => {
    expect(() => BackgroundJobsModule.forRoot({})).toThrow(/sqlExecutorToken is required/);
  });

  it('PostgresLeaseLockModule.forRoot rejects a leaseSeconds below 3', () => {
    expect(() =>
      PostgresLeaseLockModule.forRoot({ sqlExecutorToken: LOCK_DB, application: 'a', leaseSeconds: 1 }),
    ).toThrow(/leaseSeconds/);
  });
});
