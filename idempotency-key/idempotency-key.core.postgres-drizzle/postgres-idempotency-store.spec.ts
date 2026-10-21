import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresIdempotencyDuplicateCounter } from './duplicates/postgres-idempotency-duplicate-counter';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import type { SqlExecutor } from './persistence/sql-executor';

const dialect = new PgDialect();
const options = { staleAfterSeconds: 60 };

function fakeDb() {
  return { execute: vi.fn() } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

function fakeCounter() {
  return { record: vi.fn() } as unknown as PostgresIdempotencyDuplicateCounter & { record: ReturnType<typeof vi.fn> };
}

function storeOf(db: SqlExecutor, opts = options, counter = fakeCounter()) {
  return new PostgresIdempotencyStore(db, opts, counter);
}

describe('PostgresIdempotencyStore.claim', () => {
  it('claims on a fresh key with a single statement — inserted = true means not a reclaim', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-1', inserted: true }] }); // a plain INSERT — xmax = 0

    const result = await storeOf(db).claim('key-1', 'tenant-1');

    expect(result).toEqual({ status: 'claimed', claimId: expect.any(String), reclaimedStale: false });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('claims a stale abandoned row the same way, but reports reclaimedStale — the DO UPDATE branch fired (xmax != 0)', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-2', inserted: false }] });

    await expect(storeOf(db).claim('key-1', 'tenant-1')).resolves.toMatchObject({
      status: 'claimed',
      reclaimedStale: true,
    });
  });

  it('increments reclaim_count in the same atomic statement as the reclaim', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-2', inserted: false }] });
    await storeOf(db).claim('key-1', 'tenant-1');

    const { sql: text } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/reclaim_count = commons_idempotency_key\.reclaim_count \+ 1/i);
    expect(text).toMatch(/returning claim_id, \(xmax = 0\) as inserted/i);
  });

  it('threads correlationId and route into the row on both the insert and the reclaim branch', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-1', inserted: true }] });
    await storeOf(db).claim('key-1', 'tenant-1', { correlationId: 'corr-9', route: '/payments/:id' });

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/correlation_id = \$\d+, route = \$\d+/i); // the reclaim branch sets both too
    expect(params.filter((p) => p === 'corr-9')).toHaveLength(2);
    expect(params.filter((p) => p === '/payments/:id')).toHaveLength(2);
  });

  it('counts a 409 duplicate as a conflict and a replay as replayed — in memory, no extra query', async () => {
    const db = fakeDb();
    const counter = fakeCounter();
    db.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'pending', status_code: null, response_body: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', status_code: 201, response_body: {} }] });
    const store = storeOf(db, options, counter);

    await store.claim('key-1', 'tenant-1');
    await store.claim('key-2', 'tenant-1');

    expect(counter.record.mock.calls).toEqual([
      ['key-1', 'tenant-1', 'conflict'],
      ['key-2', 'tenant-1', 'replayed'],
    ]);
    expect(db.execute).toHaveBeenCalledTimes(4); // two per duplicate, as before
  });

  it('never counts the request that wins the claim', async () => {
    const db = fakeDb();
    const counter = fakeCounter();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c-1', inserted: true }] });

    await storeOf(db, options, counter).claim('key-1', 'tenant-1');

    expect(counter.record).not.toHaveBeenCalled();
  });

  it('reports in_progress for a recent, still-pending duplicate (zero-row claim, then a pending row)', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // WHERE did not match — too recent to reclaim
      .mockResolvedValueOnce({ rows: [{ status: 'pending', status_code: null, response_body: null }] });

    await expect(storeOf(db).claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'in_progress',
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('returns the cached response for a completed key', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', status_code: 201, response_body: { id: 'inv-1' } }] });

    await expect(storeOf(db).claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'completed',
      response: { statusCode: 201, body: { id: 'inv-1' } },
    });
  });

  it('race-safe re-claim: row vanished, then this attempt wins the ON CONFLICT DO NOTHING re-insert — not a stale reclaim', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // failed claim
      .mockResolvedValueOnce({ rows: [] }) // fallback SELECT finds nothing — row was deleted
      .mockResolvedValueOnce({ rows: [{ claim_id: 'c-3' }] }); // the DO NOTHING re-insert won

    const store = storeOf(db);
    await expect(store.claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'claimed',
      claimId: expect.any(String),
      reclaimedStale: false,
    });

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

    await expect(storeOf(db).claim('key-1', 'tenant-1')).resolves.toEqual({
      status: 'in_progress',
    });
    expect(db.execute).toHaveBeenCalledTimes(4);
  });

  it('passes staleAfterSeconds as a bound parameter to make_interval', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ claim_id: 'c', inserted: true }] });
    await storeOf(db, { staleAfterSeconds: 45 }).claim('k', 's');

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/make_interval\(secs => \$\d+\)/i);
    expect(params).toContain(45);
  });
});

describe('PostgresIdempotencyStore.complete', () => {
  it('updates guarded by key + scope + claim_id, and returns the key to detect whether it applied', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ key: 'k1' }] }); // 1 row updated

    await storeOf(db).complete('k1', 's1', 'claim-xyz', {
      statusCode: 200,
      body: { ok: true },
    });

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/update commons_idempotency_key/i);
    expect(text).toMatch(/where key = \$\d+ and scope = \$\d+ and claim_id = \$\d+/i);
    expect(text).toMatch(/returning key/i);
    expect(params).toEqual(expect.arrayContaining(['k1', 's1', 'claim-xyz']));
    expect(db.execute).toHaveBeenCalledTimes(1); // applied — no follow-up counter update needed
  });

  it('a 0-row update (claim was reclaimed out from under it) logs a warning and increments late_complete_no_op_count', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // the UPDATE matched nothing — claim_id no longer matches
      .mockResolvedValueOnce({ rows: [] }); // the follow-up counter UPDATE
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await storeOf(db).complete('k1', 's1', 'stale-claim', {
      statusCode: 200,
      body: {},
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('k1');
    expect(db.execute).toHaveBeenCalledTimes(2);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[1][0] as SQL);
    expect(text).toMatch(/late_complete_no_op_count = late_complete_no_op_count \+ 1/i);
    expect(params).toEqual(expect.arrayContaining(['k1', 's1']));
  });

  it('a failure to record the no-op counter is logged and swallowed — never surfaces past complete()', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [] }) // no-op UPDATE
      .mockRejectedValueOnce(new Error('connection reset')); // the counter UPDATE fails
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      storeOf(db).complete('k1', 's1', 'stale-claim', { statusCode: 200, body: {} }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
