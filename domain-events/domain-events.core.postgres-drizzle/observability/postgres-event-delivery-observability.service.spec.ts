import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresEventDeliveryObservabilityService } from './postgres-event-delivery-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';
import { encodeKeysetCursor } from '../../domain-events.core';

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

  it('defaults to newest-first (order by delivered_at desc, id desc)', async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries();
    expect(rendered(db).sql).toMatch(/order by delivered_at desc, id desc/i);
  });

  it("honors order: 'asc' for a chronological read, including the cursor comparison direction", async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries({ order: 'asc' });
    expect(rendered(db).sql).toMatch(/order by delivered_at asc, id asc/i);

    const cursor = encodeKeysetCursor(new Date('2026-06-01T10:00:00Z'), 'id-5');
    const db2 = fakeDb([]);
    await service(db2).listDeliveries({ order: 'asc', cursor });
    expect(rendered(db2).sql).toMatch(/delivered_at > .* or .*delivered_at = .* and id >/is);
  });
});

describe('PostgresEventDeliveryObservabilityService.deliveryStats', () => {
  it('scopes to the application and the since cutoff, and maps per-day + top-event rows', async () => {
    const dayRows = [
      { day: '2026-06-01', total: '3', no_listener_count: '1', dispatch_failed_count: '0' },
      { day: '2026-06-02', total: '5', no_listener_count: '0', dispatch_failed_count: '1' },
    ];
    const topRows = [{ event_name: 'invoice.sent', total_deliveries: '6' }];
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: dayRows })
        .mockResolvedValueOnce({ rows: topRows }),
    } satisfies SqlExecutor as SqlExecutor & { execute: ReturnType<typeof vi.fn> };

    const since = new Date('2026-06-01T00:00:00Z');
    const stats = await service(db).deliveryStats(since);

    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toContain('ascendra-pay');
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql).toMatch(/group by date_trunc\('day', delivered_at\)/i);
    expect(dialect.sqlToQuery(db.execute.mock.calls[1][0] as SQL).sql).toMatch(/group by event_name/i);

    expect(stats).toEqual({
      perDay: [
        { date: '2026-06-01', total: 3, noListenerCount: 1, dispatchFailedCount: 0 },
        { date: '2026-06-02', total: 5, noListenerCount: 0, dispatchFailedCount: 1 },
      ],
      topEvents: [{ eventName: 'invoice.sent', totalDeliveries: 6 }],
      noListenerRate: 1 / 8,
      dispatchFailedRate: 1 / 8,
    });
  });

  it('returns zero rates rather than dividing by zero when the window has no deliveries', async () => {
    const db = {
      execute: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }),
    } satisfies SqlExecutor as SqlExecutor & { execute: ReturnType<typeof vi.fn> };

    const stats = await service(db).deliveryStats(new Date('2026-06-01T00:00:00Z'));

    expect(stats).toEqual({ perDay: [], topEvents: [], noListenerRate: 0, dispatchFailedRate: 0 });
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
