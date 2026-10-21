import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresRateLimitRetentionService } from './postgres-rate-limit-retention.service';
import { PostgresRateLimitRetentionModule } from './postgres-rate-limit-retention.module';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const ids = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ id: i })) });

function fakeDb(...batches: number[]) {
  const execute = vi.fn();
  for (const n of batches) execute.mockResolvedValueOnce(ids(n));
  return { execute } satisfies SqlExecutor as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe('PostgresRateLimitRetentionService.pruneRejections', () => {
  it("deletes this application's windows before the cutoff, in batches, until a short batch", async () => {
    const db = fakeDb(2, 2, 1);
    const cutoff = new Date('2026-07-01T00:00:00Z');
    await expect(new PostgresRateLimitRetentionService(db, 'ascendra-pay').pruneRejections(cutoff, 2)).resolves.toBe(5);

    expect(db.execute).toHaveBeenCalledTimes(3);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/delete from commons_rate_limit_rejection/i);
    expect(text).toMatch(/application = .* and window_start </is);
    expect(params).toEqual(['ascendra-pay', cutoff, 2]);
  });

  it('stops after one query when nothing is old enough', async () => {
    const db = fakeDb(0);
    await expect(new PostgresRateLimitRetentionService(db, 'ascendra-pay').pruneRejections(new Date())).resolves.toBe(0);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe('PostgresRateLimitRetentionModule', () => {
  it('resolves the service wired to the db token and application', async () => {
    const DB = Symbol('DB');
    const db = fakeDb(0);
    @Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
    class DbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [PostgresRateLimitRetentionModule.forRoot({ sqlExecutorToken: DB, application: 'ascendra-erp', imports: [DbModule] })],
    }).compile();

    await moduleRef.get(PostgresRateLimitRetentionService).pruneRejections(new Date());
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toContain('ascendra-erp');
  });
});
