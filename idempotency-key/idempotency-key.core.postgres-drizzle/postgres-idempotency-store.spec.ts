import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import type { SqlExecutor } from './persistence/sql-executor';

const dialect = new PgDialect();
const options = { staleAfterSeconds: 60 };

function fakeDb() {
  return { execute: vi.fn() } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe('PostgresIdempotencyStore.claim', () => {
  it('claims on a fresh key with a single statement, returning a claimId', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-1' }] }); // the INSERT ... ON CONFLICT itself won

    const result = await new PostgresIdempotencyStore(db, options).claim('key-1', 'tenant-1');

    expect(result).toEqual({ status: 'claimed', claimId: expect.any(String) });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('claims a stale abandoned row the same way — the WHERE clause matched, one row returned', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-2' }] });

    await expect(new PostgresIdempotencyStore(db, options).claim('key-1', 'tenant-1')).resolves.toMatchObject({
      status: 'claimed',
    });
  });

  it('reports in_progress for a recent, still-pending duplicate (zero-row claim, then a pending row)', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // WHERE did not match — too recent to reclaim
      .mockResolvedValueOnce({ rows: [{ status: 'pending', status_code: null, response_body: null }] });

    await expect(new PostgresIdempotencyStore(db, options).claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'in_progress',
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('returns the cached response for a completed key', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', status_code: 201, response_body: { id: 'inv-1' } }] });

    await expect(new PostgresIdempotencyStore(db, options).claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'completed',
      response: { statusCode: 201, body: { id: 'inv-1' } },
    });
  });

  it('race-safe re-claim: row vanished, then this attempt wins the ON CONFLICT DO NOTHING re-insert', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // failed claim
      .mockResolvedValueOnce({ rows: [] }) // fallback SELECT finds nothing — row was deleted
      .mockResolvedValueOnce({ rows: [{ claim_id: 'c-3' }] }); // the DO NOTHING re-insert won

    const store = new PostgresIdempotencyStore(db, options);
    await expect(store.claim('key-1', 'tenant-1')).resolves.toMatchObject({ status: 'claimed' });

    const reinsert = dialect.sqlToQuery(db.execute.mock.calls[2][0] as SQL).sql;
    expect(reinsert).toMatch(/on conflict \(key, scope\) do nothing/i); // NOT a plain INSERT that could PK-violate
  });

  it('race-safe re-claim: another request won the re-insert, so this one reads their row (in_progress)', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // failed claim
      .mockResolvedValueOnce({ rows: [] }) // fallback SELECT — nothing
      .mockResolvedValueOnce({ rows: [] }) // DO NOTHING re-insert — lost the race
      .mockResolvedValueOnce({ rows: [{ status: 'pending', status_code: null, response_body: null }] }); // their row

    await expect(new PostgresIdempotencyStore(db, options).claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'in_progress',
    });
    expect(db.execute).toHaveBeenCalledTimes(4);
  });

  it('passes staleAfterSeconds as a bound parameter to make_interval', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c' }] });
    await new PostgresIdempotencyStore(db, { staleAfterSeconds: 45 }).claim('k', 's');

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/make_interval\(secs => \$\d+\)/i);
    expect(params).toContain(45);
  });
});

describe('PostgresIdempotencyStore.complete', () => {
  it('updates guarded by key + scope + claim_id', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });

    await new PostgresIdempotencyStore(db, options).complete('k1', 's1', 'claim-xyz', {
      statusCode: 200,
      body: { ok: true },
    });

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/update commons_idempotency_key/i);
    expect(text).toMatch(/where key = \$\d+ and scope = \$\d+ and claim_id = \$\d+/i);
    expect(params).toEqual(expect.arrayContaining(['k1', 's1', 'claim-xyz']));
  });
});
