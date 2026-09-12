import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresEventDeliveryObservabilityService } from './postgres-event-delivery-observability.service';
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
    event_name: 'invoice.sent',
    method: 'emit',
    transport: 'in-process',
    occurred_at: new Date('2026-06-01T10:00:00Z'),
    delivered_at: new Date('2026-06-01T10:00:00.100Z'),
    listener_count: 2,
    status: 'delivered',
    reason: null,
    correlation_id: 'trace-1',
    ...over,
  };
}

function service(db: SqlExecutor) {
  return new PostgresEventDeliveryObservabilityService(db, 'ascendra-pay');
}

describe('PostgresEventDeliveryObservabilityService.listDeliveries', () => {
  it('always scopes to the application and maps rows to EventDeliveryRecord', async () => {
    const db = fakeDb([row({ id: 'a' }), row({ id: 'b', status: 'no_listeners', listener_count: 0 })]);
    const result = await service(db).listDeliveries();

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(result.deliveries[0]).toMatchObject({
      id: 'a',
      eventName: 'invoice.sent',
      method: 'emit',
      transport: 'in-process',
      listenerCount: 2,
      status: 'delivered',
      correlationId: 'trace-1',
    });
    expect(result.deliveries[1]).toMatchObject({ status: 'no_listeners', listenerCount: 0 });
    expect(result.nextCursor).toBeUndefined();
  });

  it('ANDs the optional filters as bound params', async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries({
      eventName: 'invoice.sent',
      method: 'emitCritical',
      status: 'dispatch_failed',
      correlationId: 'trace-xyz',
      since: new Date('2026-01-01T00:00:00Z'),
      until: new Date('2026-07-01T00:00:00Z'),
    });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/event_name =/i);
    expect(text).toMatch(/method =/i);
    expect(text).toMatch(/status =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(text).toMatch(/delivered_at >=/i);
    expect(text).toMatch(/delivered_at </i);
    expect(params).toEqual(
      expect.arrayContaining(['invoice.sent', 'emitCritical', 'dispatch_failed', 'trace-xyz']),
    );
  });

  it('returns a nextCursor when more rows exist and keys the next page off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: `id-${100 + i}` }));
    const db = fakeDb(many);
    const page = await service(db).listDeliveries({ limit: 50 });

    expect(page.deliveries).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();

    const db2 = fakeDb([]);
    await service(db2).listDeliveries({ cursor: page.nextCursor, limit: 50 });
    expect(rendered(db2).sql).toMatch(/delivered_at < .* or .*delivered_at = .* and id </is);
  });

  it('caps limit at 200 and ignores a malformed cursor', async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);

    const db2 = fakeDb([]);
    await expect(service(db2).listDeliveries({ cursor: 'garbage' })).resolves.toEqual({ deliveries: [] });
  });
});

describe('PostgresEventDeliveryObservabilityService.deliveryCatalog', () => {
  it('scopes to the application and maps the aggregate row', async () => {
    const db = fakeDb([
      {
        event_name: 'invoice.sent',
        total_deliveries: '12',
        no_listener_count: '3',
        dispatch_failed_count: '0',
        last_delivered_at: new Date('2026-06-01T10:00:00Z'),
      },
    ]);

    const entries = await service(db).deliveryCatalog();

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(rendered(db).sql).toMatch(/group by event_name/i);
    expect(entries).toEqual([
      {
        eventName: 'invoice.sent',
        totalDeliveries: 12,
        noListenerCount: 3,
        dispatchFailedCount: 0,
        lastDeliveredAt: new Date('2026-06-01T10:00:00Z'),
      },
    ]);
  });
});
