import { describe, expect, it, vi } from 'vitest';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import { SqlExecutor } from './sql-executor';

function fakeDb() {
  return { execute: vi.fn() } satisfies SqlExecutor as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

const options = { staleAfterSeconds: 60 };

describe('PostgresIdempotencyStore', () => {
  describe('claim', () => {
    it('claims on a fresh key with a single statement — no existing row to check', async () => {
      const db = fakeDb();
      db.execute.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // the INSERT ... ON CONFLICT itself wins
      const store = new PostgresIdempotencyStore(db, options);

      await expect(store.claim('key-1', 'tenant-1')).resolves.toEqual({ status: 'claimed' });
      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('claims a stale abandoned row the same way as a fresh one — both win the ON CONFLICT UPDATE', async () => {
      const db = fakeDb();
      db.execute.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // WHERE clause matched the stale row
      const store = new PostgresIdempotencyStore(db, options);

      await expect(store.claim('key-1', 'tenant-1')).resolves.toEqual({ status: 'claimed' });
    });

    it('reports in_progress for a recent, still-pending duplicate', async () => {
      const db = fakeDb();
      db.execute
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // WHERE clause did not match — too recent to reclaim
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ status: 'pending', status_code: null, response_body: null }] });
      const store = new PostgresIdempotencyStore(db, options);

      await expect(store.claim('key-1', 'tenant-1')).resolves.toEqual({ status: 'in_progress' });
      expect(db.execute).toHaveBeenCalledTimes(2);
    });

    it('returns the cached response for a completed key', async () => {
      const db = fakeDb();
      db.execute
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ status: 'completed', status_code: 201, response_body: { id: 'inv-1' } }] });
      const store = new PostgresIdempotencyStore(db, options);

      await expect(store.claim('key-1', 'tenant-1')).resolves.toEqual({
        status: 'completed',
        response: { statusCode: 201, body: { id: 'inv-1' } },
      });
    });

    it('re-inserts and still claims if the row vanished between the failed claim and the fallback read', async () => {
      const db = fakeDb();
      db.execute
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // failed claim
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // fallback SELECT finds nothing — row was deleted
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // the defensive plain INSERT
      const store = new PostgresIdempotencyStore(db, options);

      await expect(store.claim('key-1', 'tenant-1')).resolves.toEqual({ status: 'claimed' });
      expect(db.execute).toHaveBeenCalledTimes(3); // must have actually written the row, not just reported 'claimed'
    });
  });

  describe('complete', () => {
    it('issues one update statement', async () => {
      const db = fakeDb();
      db.execute.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      const store = new PostgresIdempotencyStore(db, options);

      await store.complete('key-1', 'tenant-1', { statusCode: 200, body: { ok: true } });

      expect(db.execute).toHaveBeenCalledTimes(1);
    });
  });
});
