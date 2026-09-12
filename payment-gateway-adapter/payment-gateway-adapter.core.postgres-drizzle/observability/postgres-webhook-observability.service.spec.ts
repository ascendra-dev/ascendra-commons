import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresWebhookObservabilityService } from './postgres-webhook-observability.service';
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
    gateway: 'stripe',
    gateway_reference: 'ref-1',
    status: 'succeeded',
    outcome: 'applied',
    occurred_at: new Date('2026-06-01T10:00:00Z'),
    correlation_id: 'trace-1',
    ...over,
  };
}

function service(db: SqlExecutor) {
  return new PostgresWebhookObservabilityService(db, 'ascendra-pay');
}

describe('PostgresWebhookObservabilityService.listEvents', () => {
  it('always scopes to the application and maps rows', async () => {
    const db = fakeDb([row({ id: 'a' }), row({ id: 'b', outcome: 'signature_invalid', gateway_reference: null, status: null })]);
    const result = await service(db).listEvents();

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(result.events[0]).toMatchObject({ id: 'a', gateway: 'stripe', outcome: 'applied' });
    expect(result.events[1]).toMatchObject({ outcome: 'signature_invalid', gatewayReference: null, status: null });
  });

  it('ANDs the optional filters', async () => {
    const db = fakeDb([]);
    await service(db).listEvents({ gateway: 'stripe', outcome: 'duplicate', correlationId: 'trace-xyz' });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/gateway =/i);
    expect(text).toMatch(/outcome =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(params).toEqual(expect.arrayContaining(['stripe', 'duplicate', 'trace-xyz']));
  });

  it('returns a nextCursor when more rows exist', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: `id-${100 + i}` }));
    const db = fakeDb(many);
    const page = await service(db).listEvents({ limit: 50 });

    expect(page.events).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
  });

  it('caps limit at 200 and ignores a malformed cursor', async () => {
    const db = fakeDb([]);
    await service(db).listEvents({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);

    const db2 = fakeDb([]);
    await expect(service(db2).listEvents({ cursor: 'garbage' })).resolves.toEqual({ events: [] });
  });
});

describe('PostgresWebhookObservabilityService.outcomeCounts', () => {
  it('scopes to the application and maps counts per outcome', async () => {
    const db = fakeDb([
      { outcome: 'applied', count: '900' },
      { outcome: 'signature_invalid', count: '2' },
    ]);

    await expect(service(db).outcomeCounts()).resolves.toEqual([
      { outcome: 'applied', count: 900 },
      { outcome: 'signature_invalid', count: 2 },
    ]);
    expect(rendered(db).params).toContain('ascendra-pay');
  });

  it('scopes to a since window when given', async () => {
    const db = fakeDb([]);
    await service(db).outcomeCounts(new Date('2026-01-01T00:00:00Z'));
    expect(rendered(db).sql).toMatch(/occurred_at >=/i);
  });
});
