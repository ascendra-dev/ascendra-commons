import { describe, expect, it, vi } from 'vitest';
import { PostgresAdvisoryLock } from './postgres-advisory-lock';
import { SqlExecutor } from './sql-executor';

function fakeExecutor(rows: Array<Record<string, unknown>>): SqlExecutor {
  return { execute: vi.fn().mockResolvedValue({ rows }) };
}

describe('PostgresAdvisoryLock', () => {
  it('tryAcquire returns true when Postgres grants the lock', async () => {
    const db = fakeExecutor([{ acquired: true }]);
    const lock = new PostgresAdvisoryLock(db);

    await expect(lock.tryAcquire('scheduler:invoice-reminder')).resolves.toBe(true);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('tryAcquire returns false when another instance already holds the lock', async () => {
    const db = fakeExecutor([{ acquired: false }]);
    const lock = new PostgresAdvisoryLock(db);

    await expect(lock.tryAcquire('scheduler:invoice-reminder')).resolves.toBe(false);
  });

  it('tryAcquire returns false rather than throwing if the row shape is ever unexpected', async () => {
    const db = fakeExecutor([]); // defensive: no row at all
    const lock = new PostgresAdvisoryLock(db);

    await expect(lock.tryAcquire('scheduler:invoice-reminder')).resolves.toBe(false);
  });

  it('release calls the executor once', async () => {
    const db = fakeExecutor([{ released: true }]);
    const lock = new PostgresAdvisoryLock(db);

    await lock.release('scheduler:invoice-reminder');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
