import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { JOB_LOCK_INSPECTOR_PORT, type JobLockInspectorPort } from '../../background-jobs.core';
import { PostgresLeaseLockInspector } from './postgres-lease-lock-inspector';
import { PostgresLeaseLockInspectorModule } from './postgres-lease-lock-inspector.module';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe('PostgresLeaseLockInspector', () => {
  it("lists this application's lock rows, the job name from the runner's key, state by the db clock", async () => {
    const db = fakeDb([
      { lock_key: 'scheduler:payout-sweep', holder: 'pod-7f2a#12#ab', acquired_at: new Date('2026-06-01T08:00:00Z'), locked_until: new Date('2026-06-01T08:15:00Z'), expired: false },
      { lock_key: 'custom-key', holder: 'pod-3b91#7#cd', acquired_at: '2026-06-01T02:00:00Z', locked_until: '2026-06-01T02:15:00Z', expired: true },
    ]);
    const locks = await new PostgresLeaseLockInspector(db, 'ascendra-pay').listLocks();

    expect(locks).toEqual([
      { lockKey: 'scheduler:payout-sweep', jobName: 'payout-sweep', holder: 'pod-7f2a#12#ab', acquiredAt: new Date('2026-06-01T08:00:00Z'), lockedUntil: new Date('2026-06-01T08:15:00Z'), state: 'held' },
      { lockKey: 'custom-key', jobName: null, holder: 'pod-3b91#7#cd', acquiredAt: new Date('2026-06-01T02:00:00Z'), lockedUntil: new Date('2026-06-01T02:15:00Z'), state: 'expired' },
    ]);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/locked_until < now\(\)/i);
    expect(params).toEqual(['ascendra-pay']);
  });
});

describe('PostgresLeaseLockInspectorModule', () => {
  it('binds the inspector under JOB_LOCK_INSPECTOR_PORT', async () => {
    const DB = Symbol('DB');
    const db = fakeDb();
    @Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
    class DbModule {}

    const ref = await Test.createTestingModule({
      imports: [PostgresLeaseLockInspectorModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] })],
    }).compile();
    await ref.get<JobLockInspectorPort>(JOB_LOCK_INSPECTOR_PORT).listLocks();
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toContain('ascendra-erp');
  });
});
