import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { SqlExecutor } from '../persistence/sql-executor';
import { OVERFLOW_ACTOR, PostgresAccessDenialRecorder } from './postgres-access-denial-recorder';

const dialect = new PgDialect();
const fakeDb = () => ({ execute: vi.fn().mockResolvedValue({ rows: [] }) }) as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
const at = new Date('2026-10-23T10:15:20Z');
const denial = (over: Record<string, unknown> = {}) => ({
  actorId: 'u1', tenantId: 't1', action: 'job.run', method: 'post', route: '/jobs/:name/run', at, ...over,
});

const recorders: PostgresAccessDenialRecorder[] = [];
const make = (db: SqlExecutor, opts = {}) => {
  const r = new PostgresAccessDenialRecorder(db, 'app', { flushIntervalMs: 60_000, ...opts });
  recorders.push(r);
  return r;
};
afterEach(async () => {
  for (const r of recorders.splice(0)) await r.onModuleDestroy();
});

describe('PostgresAccessDenialRecorder', () => {
  it('does no I/O per denial — counts a minute window in memory, then upserts it on flush', async () => {
    const db = fakeDb();
    const r = make(db);
    r.recordDenial(denial());
    r.recordDenial(denial({ at: new Date('2026-10-23T10:15:50Z') }));
    expect(db.execute).not.toHaveBeenCalled();

    await r.flush();
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/on conflict on constraint commons_authz_denial_window_uq do update/i);
    expect(params).toEqual(expect.arrayContaining(['app', 'u1', 't1', 'job.run', 'POST', '/jobs/:name/run', new Date('2026-10-23T10:15:00Z'), 2]));
  });

  it('normalizes each denial so one malformed value cannot sink the batch', async () => {
    const db = fakeDb();
    const r = make(db);
    r.recordDenial(denial({ actorId: 'a\u0000b', route: 'x'.repeat(1000), at: new Date('nope'), method: undefined }));
    await r.flush();
    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).toContain('ab');
    expect(params).toContain('x'.repeat(256));
    expect(params).toContain('GET');
    expect(params).not.toContain(undefined);
  });

  it('never splits a window by correlation id — every request has its own; the latest one is kept as a sample', async () => {
    const db = fakeDb();
    const r = make(db, { correlationIdResolver: () => 'ambient-1' });
    r.recordDenial(denial({ correlationId: 'req-1' }));
    r.recordDenial(denial({ correlationId: 'req-2', at: new Date('2026-10-23T10:15:30Z') }));
    r.recordDenial(denial({ correlationId: 'bad id!', at: new Date('2026-10-23T10:15:10Z') }));
    await r.flush();
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining([3, 'req-2'])); // one window, three denials, the latest id
    expect(params).not.toContain('req-1');
    expect(params).not.toContain('bad id!');
    expect(text).toMatch(/correlation_id = case when excluded\.last_denied_at >= d\.last_denied_at/i);
  });

  it('falls back to the ambient correlation id for a denial sent without one', async () => {
    const db = fakeDb();
    const r = make(db, { correlationIdResolver: () => 'ambient-1' });
    r.recordDenial(denial());
    await r.flush();
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toContain('ambient-1');
  });

  it('is bounded — past maxBufferedKeys, new actors count under (overflow) so totals stay exact', async () => {
    const db = fakeDb();
    const r = make(db, { maxBufferedKeys: 1 });
    r.recordDenial(denial({ actorId: 'u1' }));
    r.recordDenial(denial({ actorId: 'u2' }));
    r.recordDenial(denial({ actorId: 'u3' }));
    await r.flush();
    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).toContain(OVERFLOW_ACTOR);
    expect(params).toEqual(expect.arrayContaining([1, 2])); // u1 once, (overflow) twice
  });

  it('logs and drops a failed write — never throws — and flushes on shutdown', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('db down'));
    const r = make(db);
    r.recordDenial(denial());
    await expect(r.flush()).resolves.toBeUndefined();

    r.recordDenial(denial());
    await r.onModuleDestroy();
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
