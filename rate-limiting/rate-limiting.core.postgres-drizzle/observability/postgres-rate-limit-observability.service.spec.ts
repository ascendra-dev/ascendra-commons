import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresRateLimitObservabilityService } from './postgres-rate-limit-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

let seq = 0;
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `id-${seq}`,
    route: '/pay/:token',
    identifier: '203.0.113.7',
    limit: 20,
    ttl_ms: 60_000,
    rejected_at: new Date('2026-06-01T10:00:00Z'),
    correlation_id: 'trace-1',
    ...over,
  };
}

function service(db: SqlExecutor) {
  return new PostgresRateLimitObservabilityService(db, 'ascendra-pay');
}

describe('PostgresRateLimitObservabilityService.listRejections', () => {
  it('always scopes to the application and maps rows', async () => {
    const db = fakeDb([row({ id: 'a' }), row({ id: 'b', identifier: '198.51.100.1' })]);
    const result = await service(db).listRejections();

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(result.rejections[0]).toMatchObject({ id: 'a', route: '/pay/:token', limit: 20, ttlMs: 60_000 });
  });

  it('ANDs the optional filters', async () => {
    const db = fakeDb([]);
    await service(db).listRejections({ route: '/pay/:token', identifier: '203.0.113.7', correlationId: 'trace-xyz' });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/route =/i);
    expect(text).toMatch(/identifier =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(params).toEqual(expect.arrayContaining(['/pay/:token', '203.0.113.7', 'trace-xyz']));
  });

  it('returns a nextCursor when more rows exist', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: `id-${100 + i}` }));
    const db = fakeDb(many);
    const page = await service(db).listRejections({ limit: 50 });

    expect(page.rejections).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
  });

  it('caps limit at 200 and ignores a malformed cursor', async () => {
    const db = fakeDb([]);
    await service(db).listRejections({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);

    const db2 = fakeDb([]);
    await expect(service(db2).listRejections({ cursor: 'garbage' })).resolves.toEqual({ rejections: [] });
  });
});

describe('PostgresRateLimitObservabilityService.rejectionCatalog', () => {
  it('scopes to the application, groups by route, orders by count desc', async () => {
    const db = fakeDb([
      { route: '/pay/:token', count: '318' },
      { route: '/invoices', count: '4' },
    ]);

    await expect(service(db).rejectionCatalog()).resolves.toEqual([
      { route: '/pay/:token', count: 318 },
      { route: '/invoices', count: 4 },
    ]);
    expect(rendered(db).sql).toMatch(/order by count desc/i);
  });

  it('scopes to a since window when given', async () => {
    const db = fakeDb([]);
    await service(db).rejectionCatalog(new Date('2026-01-01T00:00:00Z'));
    expect(rendered(db).sql).toMatch(/rejected_at >=/i);
  });
});
