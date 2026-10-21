import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  PostgresIdempotencyDuplicateCounter,
  type PostgresIdempotencyDuplicateCounterOptions,
} from './postgres-idempotency-duplicate-counter';
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

let counters: PostgresIdempotencyDuplicateCounter[] = [];
function counter(db: SqlExecutor, options?: PostgresIdempotencyDuplicateCounterOptions) {
  const c = new PostgresIdempotencyDuplicateCounter(db, options);
  counters.push(c);
  return c;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T09:40:51Z'));
});

afterEach(async () => {
  for (const c of counters) await c.onModuleDestroy();
  counters = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PostgresIdempotencyDuplicateCounter', () => {
  it('does no I/O on record — a duplicate never waits on Postgres to be counted', () => {
    const db = fakeDb();
    counter(db).record('k1', 's1', 'replayed');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('sums replays and 409s per claim and adds them onto the row in one UPDATE … FROM (VALUES …)', async () => {
    const db = fakeDb();
    const c = counter(db);
    c.record('k1', 's1', 'conflict');
    c.record('k1', 's1', 'replayed');
    vi.setSystemTime(new Date('2026-10-21T09:40:58Z'));
    c.record('k1', 's1', 'replayed');
    c.record('k2', 's1', 'replayed');
    await c.flush();

    expect(db.execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/update commons_idempotency_key as k set/i);
    expect(text).toMatch(/replay_count = k\.replay_count \+ v\.replays/i);
    expect(text).toMatch(/conflict_count = k\.conflict_count \+ v\.conflicts/i);
    expect(text).toMatch(/last_duplicate_at = greatest\(k\.last_duplicate_at, v\.last_at\)/i);
    expect(text).toMatch(/where k\.key = v\.key and k\.scope = v\.scope/i);
    expect(params).toEqual([
      'k1', 's1', 2, 1, new Date('2026-10-21T09:40:58Z'),
      'k2', 's1', 1, 0, new Date('2026-10-21T09:40:58Z'),
    ]);
  });

  it('keeps the same key under different scopes apart', async () => {
    const db = fakeDb();
    const c = counter(db);
    c.record('k1', 'tenant-a', 'replayed');
    c.record('k1', 'tenant-b', 'replayed');
    await c.flush();
    expect(rendered(db).params.filter((p) => p === 'k1')).toHaveLength(2);
  });

  it('flushes on the interval, and skips an empty buffer', async () => {
    const db = fakeDb();
    const c = counter(db, { flushIntervalMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(db.execute).not.toHaveBeenCalled();

    c.record('k1', 's1', 'replayed');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('once the buffer is full, drops duplicates on new claims — still counting the ones already held — and logs the drop', async () => {
    const db = fakeDb();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const c = counter(db, { maxBufferedKeys: 2 });
    c.record('k1', 's1', 'replayed');
    c.record('k2', 's1', 'replayed');
    c.record('k3', 's1', 'replayed'); // dropped
    c.record('k4', 's1', 'conflict'); // dropped
    c.record('k1', 's1', 'replayed'); // held — still counted
    await c.flush();

    expect(rendered(db).params).toEqual(['k1', 's1', 2, 0, expect.any(Date), 'k2', 's1', 1, 0, expect.any(Date)]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^2 duplicate request\(s\) not counted/);
  });

  it('splits a large flush into several updates', async () => {
    const db = fakeDb();
    const c = counter(db, { maxBufferedKeys: 5_000 });
    for (let i = 0; i < 2_500; i += 1) c.record(`k${i}`, 's1', 'replayed');
    await c.flush();
    expect(db.execute).toHaveBeenCalledTimes(3); // 1,000 + 1,000 + 500
  });

  it('starts a fresh buffer while a flush is in flight, and skips an overlapping flush', async () => {
    const db = fakeDb();
    let release!: () => void;
    db.execute.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ rows: [] }))));
    const c = counter(db);
    c.record('k1', 's1', 'replayed');
    const first = c.flush();
    c.record('k2', 's1', 'replayed'); // lands in the new buffer
    await c.flush(); // skipped — the first is still running
    expect(db.execute).toHaveBeenCalledTimes(1);

    release();
    await first;
    await c.flush();
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(rendered(db, 1).params).toEqual(['k2', 's1', 1, 0, expect.any(Date)]);
  });

  it('never throws when the update fails — logged and dropped, not retried', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('connection reset'));
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const c = counter(db);
    c.record('k1', 's1', 'replayed');
    c.record('k1', 's1', 'conflict');

    await expect(c.flush()).resolves.toBeUndefined();
    expect(error.mock.calls[0][0]).toMatch(/^Failed to record 2 duplicate request\(s\)/);

    await c.flush();
    expect(db.execute).toHaveBeenCalledTimes(1); // the failed counts are gone, not retried
  });

  it('flushes what is left on shutdown', async () => {
    const db = fakeDb();
    const c = counter(db);
    c.record('k1', 's1', 'replayed');
    await c.onModuleDestroy();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
