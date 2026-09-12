import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresRateLimitEventRecorder } from './postgres-rate-limit-event-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>) {
  return dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
}

describe('PostgresRateLimitEventRecorder', () => {
  it('inserts one row with application, route, identifier, limit, ttlMs, correlationId', async () => {
    const db = fakeDb();
    await new PostgresRateLimitEventRecorder(db, 'ascendra-pay').recordRejection({
      route: '/pay/:token',
      identifier: '203.0.113.7',
      limit: 20,
      ttlMs: 60_000,
      correlationId: 'corr-1',
    });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_rate_limit_rejection/i);
    expect(params).toEqual(
      expect.arrayContaining(['ascendra-pay', '/pay/:token', '203.0.113.7', 20, 60_000, 'corr-1']),
    );
  });

  it('writes a null correlationId as a real SQL NULL when absent', async () => {
    const db = fakeDb();
    await new PostgresRateLimitEventRecorder(db, 'ascendra-pay').recordRejection({
      route: '/pay/:token',
      identifier: '203.0.113.7',
      limit: 20,
      ttlMs: 60_000,
    });

    expect(rendered(db).params).not.toContain('null');
  });

  it('never throws when the insert fails — logged and swallowed', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      new PostgresRateLimitEventRecorder(db, 'ascendra-pay').recordRejection({
        route: '/pay/:token',
        identifier: '1.2.3.4',
        limit: 20,
        ttlMs: 60_000,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
