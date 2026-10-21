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
    window_start: new Date('2026-06-01T10:00:00Z'),
    rejection_count: 7,
    first_rejected_at: new Date('2026-06-01T10:00:03Z'),
    last_rejected_at: '2026-06-01T10:00:41Z',
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
    expect(result.rejections[0]).toEqual({
      id: 'a',
      route: '/pay/:token',
      identifier: '203.0.113.7',
      limit: 20,
      ttlMs: 60_000,
      windowStart: new Date('2026-06-01T10:00:00Z'),
      count: 7,
      firstRejectedAt: new Date('2026-06-01T10:00:03Z'),
      lastRejectedAt: new Date('2026-06-01T10:00:41Z'),
      correlationId: 'trace-1',
    });
    expect(rendered(db).sql).toMatch(/order by window_start desc, id desc/i);
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
  it('scopes to the application, sums the window counts per route, orders by count desc', async () => {
    const db = fakeDb([
      { route: '/pay/:token', count: '318' },
      { route: '/invoices', count: '4' },
    ]);

    await expect(service(db).rejectionCatalog()).resolves.toEqual([
      { route: '/pay/:token', count: 318 },
      { route: '/invoices', count: 4 },
    ]);
    expect(rendered(db).sql).toMatch(/sum\(rejection_count\) as count/i);
    expect(rendered(db).sql).toMatch(/order by count desc/i);
  });

  it('scopes to a since window when given', async () => {
    const db = fakeDb([]);
    await service(db).rejectionCatalog(new Date('2026-01-01T00:00:00Z'));
    expect(rendered(db).sql).toMatch(/window_start >=/i);
  });
});

describe('PostgresRateLimitObservabilityService.topIdentifiers', () => {
  it('sums per identifier with its routes and last-seen, most first, default 10', async () => {
    const db = fakeDb([
      { identifier: '203.0.113.7', count: '318', routes: ['/invoices', '/pay/:token'], last_rejected_at: '2026-09-12T09:41:02Z' },
    ]);

    await expect(service(db).topIdentifiers()).resolves.toEqual([
      {
        identifier: '203.0.113.7',
        count: 318,
        routes: ['/invoices', '/pay/:token'],
        lastRejectedAt: new Date('2026-09-12T09:41:02Z'),
      },
    ]);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/group by identifier\s+order by count desc, identifier/i);
    expect(params).toEqual(['ascendra-pay', 10]);
  });

  it('applies since and route, and caps limit at 100', async () => {
    const db = fakeDb([]);
    const since = new Date('2026-09-12T00:00:00Z');
    await service(db).topIdentifiers({ since, route: '/pay/:token', limit: 5_000 });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/window_start >= .* and route =/is);
    expect(params).toEqual(['ascendra-pay', since, '/pay/:token', 100]);
  });
});
