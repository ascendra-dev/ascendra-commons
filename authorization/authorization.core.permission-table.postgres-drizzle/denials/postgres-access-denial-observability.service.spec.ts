import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { InvalidAuthzCursorError } from '../../authorization.core.permission-table';
import type { SqlExecutor } from '../persistence/sql-executor';
import { PostgresAccessDenialObservabilityService, PostgresAccessDenialRetention } from './postgres-access-denial-observability.service';

const dialect = new PgDialect();
const fakeDb = (rows: unknown[] = []) =>
  ({ execute: vi.fn().mockResolvedValue({ rows }) }) as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
const row = (id: number) => ({
  id, actor_id: 'u1', tenant_id: 't1', action: 'job.run', method: 'POST', route: '/jobs/:name/run',
  window_start: new Date('2026-10-23T10:15:00Z'), denial_count: '3', first_denied_at: new Date(), last_denied_at: new Date(),
  correlation_id: null, window_start_key: '2026-10-23T10:15:00.000000Z',
});

describe('PostgresAccessDenialObservabilityService', () => {
  it('lists newest first, application- and tenant-scoped, with a JSON keyset cursor led by window_start', async () => {
    const db = fakeDb([row(3), row(2), row(1)]);
    const svc = new PostgresAccessDenialObservabilityService(db, 'app');
    const page = await svc.listDenials({ tenantId: 't1', limit: 2 });
    expect(page.denials).toHaveLength(2);
    expect(page.denials[0]).toMatchObject({ id: '3', count: 3 });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/order by window_start desc, id desc/i);
    expect(params).toEqual(expect.arrayContaining(['app', 't1']));

    const next = fakeDb();
    await new PostgresAccessDenialObservabilityService(next, 'app').listDenials({ cursor: page.nextCursor });
    expect(dialect.sqlToQuery(next.execute.mock.calls[0][0] as SQL).sql).toMatch(/window_start <= .* and \(window_start < .* or id < /i);

    await expect(svc.listDenials({ cursor: 'garbage' })).rejects.toBeInstanceOf(InvalidAuthzCursorError);
  });

  it('summarizes totals and the most-denied actions and actors', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [{ total: '9', actors: '2' }] })
      .mockResolvedValueOnce({ rows: [{ action: 'job.run', count: '7', actors: '2' }] })
      .mockResolvedValueOnce({ rows: [{ actor_id: 'u1', tenant_id: 't1', count: '6', actions: '1' }] });
    await expect(new PostgresAccessDenialObservabilityService(db, 'app').denialSummary({ since: new Date() })).resolves.toEqual({
      total: 9, actors: 2,
      topActions: [{ action: 'job.run', count: 7, actors: 2 }],
      topActors: [{ actorId: 'u1', tenantId: 't1', count: 6, actions: 1 }],
    });
  });

  it('prunes in batches until a short one', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }).mockResolvedValueOnce({ rows: [{ id: 3 }] });
    await expect(new PostgresAccessDenialRetention(db, 'app').pruneDenials(new Date(), 2)).resolves.toBe(3);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
