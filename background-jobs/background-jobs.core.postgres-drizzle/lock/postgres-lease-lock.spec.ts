import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresLeaseLock } from './postgres-lease-lock';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(): SqlExecutor & { execute: ReturnType<typeof vi.fn> } {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

function rendered(db: ReturnType<typeof fakeDb>, call: number) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

/**
 * The lease lock echoes its own generated `holder` back from the claim, so the
 * fake DB reflects the INSERT's holder param (index 2) to mean "you got it".
 */
function grants(db: ReturnType<typeof fakeDb>) {
  db.execute.mockImplementation(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (/insert into commons_jobs_lock/i.test(text)) return { rows: [{ holder: params[2] }] };
    return { rows: [{ lock_key: 'k' }] };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PostgresLeaseLock.tryAcquire', () => {
  it('issues the conditional upsert and returns true when it holds the row', async () => {
    const db = fakeDb();
    grants(db);
    const lock = new PostgresLeaseLock(db, 'ascendra-pay', 900);

    await expect(lock.tryAcquire('scheduler:invoice-reminder')).resolves.toBe(true);

    const { sql: text, params } = rendered(db, 0);
    expect(text).toMatch(/insert into commons_jobs_lock/i);
    expect(text).toMatch(/on conflict .*do update/is);
    expect(text).toMatch(/where commons_jobs_lock\.locked_until < now\(\)/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', 'scheduler:invoice-reminder', 900]));

    await lock.release('scheduler:invoice-reminder');
  });

  it('returns false when the upsert affects no row (a live lease is held elsewhere)', async () => {
    const db = fakeDb(); // default: rows: []
    const lock = new PostgresLeaseLock(db, 'ascendra-pay', 900);
    await expect(lock.tryAcquire('scheduler:x')).resolves.toBe(false);
  });
});

describe('PostgresLeaseLock.release', () => {
  it('deletes only this process\'s own row (application + key + holder)', async () => {
    const db = fakeDb();
    grants(db);
    const lock = new PostgresLeaseLock(db, 'ascendra-erp', 900);
    await lock.tryAcquire('scheduler:x');

    db.execute.mockClear();
    db.execute.mockResolvedValue({ rows: [{ lock_key: 'scheduler:x' }] });
    await lock.release('scheduler:x');

    const { sql: text, params } = rendered(db, 0);
    expect(text).toMatch(/delete from commons_jobs_lock/i);
    expect(text).toMatch(/holder =/i);
    expect(params).toContain('ascendra-erp');
    expect(params).toContain('scheduler:x');
  });
});

describe('PostgresLeaseLock heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renews locked_until every leaseSeconds/3 while the lock is held, and stops on release', async () => {
    const db = fakeDb();
    grants(db);
    const lock = new PostgresLeaseLock(db, 'ascendra-pay', 900); // heartbeat every 300s
    await lock.tryAcquire('scheduler:x');
    db.execute.mockClear();
    db.execute.mockResolvedValue({ rows: [{ lock_key: 'scheduler:x' }] });

    await vi.advanceTimersByTimeAsync(300_000);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(rendered(db, 0).sql).toMatch(/update commons_jobs_lock\s+set locked_until/i);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(db.execute).toHaveBeenCalledTimes(2);

    await lock.release('scheduler:x');
    db.execute.mockClear();
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(db.execute).not.toHaveBeenCalled(); // heartbeat cleared
  });

  it('warns and stops the heartbeat when the lease was lost (row gone)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const db = fakeDb();
    grants(db);
    const lock = new PostgresLeaseLock(db, 'ascendra-pay', 900);
    await lock.tryAcquire('scheduler:x');

    db.execute.mockClear();
    db.execute.mockResolvedValue({ rows: [] }); // heartbeat UPDATE hits nothing
    await vi.advanceTimersByTimeAsync(300_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lease lapsed'));

    db.execute.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(db.execute).not.toHaveBeenCalled(); // stopped after the loss
  });

  it('onModuleDestroy clears every heartbeat', async () => {
    const db = fakeDb();
    grants(db);
    const lock = new PostgresLeaseLock(db, 'ascendra-pay', 900);
    await lock.tryAcquire('scheduler:a');
    await lock.tryAcquire('scheduler:b');

    lock.onModuleDestroy();
    db.execute.mockClear();
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
