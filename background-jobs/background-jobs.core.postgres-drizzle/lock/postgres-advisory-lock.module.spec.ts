import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { BackgroundJobsModule, IdempotentJobRunner } from '../../background-jobs.core';
import { PostgresAdvisoryLockModule } from './postgres-advisory-lock.module';
import { POSTGRES_ADVISORY_LOCK } from '../tokens';

const LOCK_DB = Symbol('LOCK_DB');
const dialect = new PgDialect();

describe('PostgresAdvisoryLockModule wired into BackgroundJobsModule', () => {
  it('runs a job through the session-level advisory lock', async () => {
    const execute = vi.fn(async (q: SQL) => {
      const text = dialect.sqlToQuery(q).sql;
      if (/pg_try_advisory_lock/i.test(text)) return { rows: [{ acquired: true }] };
      if (/pg_advisory_unlock/i.test(text)) return { rows: [{ released: true }] };
      return { rows: [] };
    });
    @Module({ providers: [{ provide: LOCK_DB, useValue: { execute } }], exports: [LOCK_DB] })
    class LockDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        BackgroundJobsModule.forRoot({
          advisoryLockToken: POSTGRES_ADVISORY_LOCK,
          imports: [PostgresAdvisoryLockModule.forRoot({ sqlExecutorToken: LOCK_DB, imports: [LockDbModule] })],
        }),
      ],
    }).compile();

    await moduleRef.get(IdempotentJobRunner).run({
      name: 'demo',
      findDueItems: async () => ['a'],
      processItem: vi.fn().mockResolvedValue(undefined),
    });

    expect(execute.mock.calls.some((c) => /pg_try_advisory_lock/i.test(dialect.sqlToQuery(c[0] as SQL).sql))).toBe(true);
    expect(execute.mock.calls.some((c) => /pg_advisory_unlock/i.test(dialect.sqlToQuery(c[0] as SQL).sql))).toBe(true);
    await moduleRef.close();
  });
});
