import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { RateLimitRejection } from '../../rate-limiting.core';
import {
  OVERFLOW_IDENTIFIER,
  PostgresRateLimitEventRecorder,
  type PostgresRateLimitEventRecorderOptions,
} from './postgres-rate-limit-event-recorder';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

const PAY: RateLimitRejection = { route: '/pay/:token', identifier: '203.0.113.7', limit: 20, ttlMs: 60_000 };

let recorders: PostgresRateLimitEventRecorder[] = [];
function recorder(db: SqlExecutor, options?: PostgresRateLimitEventRecorderOptions) {
  const r = new PostgresRateLimitEventRecorder(db, 'ascendra-pay', options);
  recorders.push(r);
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-12T09:40:51Z'));
});

afterEach(async () => {
  for (const r of recorders) await r.onModuleDestroy();
  recorders = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PostgresRateLimitEventRecorder', () => {
  it('does no I/O on recordRejection — the 429 path never waits on Postgres', async () => {
    const db = fakeDb();
    await recorder(db).recordRejection(PAY);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('counts repeat rejections into one window row and upserts it on flush', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordRejection({ ...PAY, correlationId: 'corr-1' });
    vi.setSystemTime(new Date('2026-09-12T09:40:58Z'));
    await r.recordRejection({ ...PAY, correlationId: 'corr-1' });
    await r.flush();

    expect(db.execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_rate_limit_rejection/i);
    expect(text).toMatch(/on conflict .* do update set\s+rejection_count = r\.rejection_count \+ excluded\.rejection_count/is);
    expect(params).toEqual([
      'ascendra-pay',
      '/pay/:token',
      '203.0.113.7',
      20,
      60_000,
      new Date('2026-09-12T09:40:00.000Z'),
      2,
      new Date('2026-09-12T09:40:51.000Z'),
      new Date('2026-09-12T09:40:58.000Z'),
      'corr-1',
    ]);
  });

  it('keeps sources, correlation ids and minutes apart as separate rows', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordRejection(PAY);
    await r.recordRejection({ ...PAY, identifier: '198.51.100.9' });
    await r.recordRejection({ ...PAY, correlationId: 'corr-1' });
    vi.setSystemTime(new Date('2026-09-12T09:41:02Z'));
    await r.recordRejection(PAY);
    await r.flush();

    // 10 params per row.
    expect(rendered(db).params).toHaveLength(40);
  });

  it('writes a missing correlation id as a real SQL NULL', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordRejection(PAY);
    await r.flush();

    const { params } = rendered(db);
    expect(params[params.length - 1]).toBeNull();
  });

  it('flushes on the interval, and skips an empty buffer', async () => {
    const db = fakeDb();
    const r = recorder(db, { flushIntervalMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(db.execute).not.toHaveBeenCalled();

    await r.recordRejection(PAY);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('counts new sources under the overflow identifier once the buffer is full — the route total stays exact', async () => {
    const db = fakeDb();
    const r = recorder(db, { maxBufferedKeys: 2 });
    await r.recordRejection({ ...PAY, identifier: 'a' });
    await r.recordRejection({ ...PAY, identifier: 'b' });
    await r.recordRejection({ ...PAY, identifier: 'c', correlationId: 'corr-c' });
    await r.recordRejection({ ...PAY, identifier: 'd' });
    await r.recordRejection({ ...PAY, identifier: 'a' }); // already buffered — still counted under its own row
    await r.flush();

    const { params } = rendered(db);
    const rows = Array.from({ length: params.length / 10 }, (_, i) => params.slice(i * 10, i * 10 + 10));
    expect(rows.map((row) => [row[2], row[6], row[9]])).toEqual([
      ['a', 2, null],
      ['b', 1, null],
      [OVERFLOW_IDENTIFIER, 2, null],
    ]);
  });

  it('splits a large flush into several inserts', async () => {
    const db = fakeDb();
    const r = recorder(db, { maxBufferedKeys: 5_000 });
    for (let i = 0; i < 2_500; i++) await r.recordRejection({ ...PAY, identifier: `10.0.${i >> 8}.${i & 255}` });
    await r.flush();

    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('starts a fresh buffer while a flush is in flight, and skips an overlapping flush', async () => {
    let release!: () => void;
    const db = fakeDb();
    db.execute.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ rows: [] }))));
    const r = recorder(db);
    await r.recordRejection(PAY);
    const first = r.flush();

    await r.recordRejection({ ...PAY, identifier: '198.51.100.9' });
    await r.flush(); // skipped — the first is still writing
    expect(db.execute).toHaveBeenCalledTimes(1);

    release();
    await first;
    await r.flush();
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(rendered(db, 1).params).toContain('198.51.100.9');
  });

  it('never throws when the upsert fails — logged and dropped, not retried', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const r = recorder(db);
    await r.recordRejection(PAY);
    await r.recordRejection(PAY);

    await expect(r.flush()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('2 rate-limit rejection(s)'), expect.any(String));

    await r.flush();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('flushes what is left on shutdown', async () => {
    const db = fakeDb();
    const r = recorder(db);
    await r.recordRejection(PAY);
    await r.onModuleDestroy();

    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
