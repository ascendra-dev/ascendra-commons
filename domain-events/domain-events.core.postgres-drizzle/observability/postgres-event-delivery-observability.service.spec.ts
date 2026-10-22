import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresEventDeliveryObservabilityService } from './postgres-event-delivery-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';
import { encodeKeysetCursor, InvalidDeliveryCursorError } from '../../domain-events.core';

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
    id: `${seq}`,
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
    const db = fakeDb([row({ id: '1' }), row({ id: '2', status: 'no_listeners', listener_count: 0 })]);
    const result = await service(db).listDeliveries();

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(result.deliveries[0]).toMatchObject({
      id: '1',
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
    expect(text).toMatch(/occurred_at >=/i);
    expect(text).toMatch(/occurred_at </i);
    expect(text).not.toMatch(/delivered_at [<>]/i);
    expect(params).toEqual(
      expect.arrayContaining(['invoice.sent', 'emitCritical', 'dispatch_failed', 'trace-xyz']),
    );
  });

  it('returns a nextCursor when more rows exist and keys the next page off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: `${100 + i}` }));
    const db = fakeDb(many);
    const page = await service(db).listDeliveries({ limit: 50 });

    expect(page.deliveries).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();

    const db2 = fakeDb([]);
    await service(db2).listDeliveries({ cursor: page.nextCursor, limit: 50 });
    // `<=` first, so the scan starts at the boundary instead of filtering from the newest row.
    expect(rendered(db2).sql).toMatch(/occurred_at <= \$\d+ and \(occurred_at < \$\d+ or id < \$\d+\)/i);
  });

  it('caps limit at 200', async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);
  });

  it.each([
    ['garbage', 'garbage'],
    ['a non-numeric id', encodeKeysetCursor(new Date('2026-06-01T10:00:00Z'), 'abc')],
    ['an extra part', Buffer.from('2026-06-01T10:00:00.000Z|5|x').toString('base64url')],
  ])('rejects a cursor it never issued (%s), before querying', async (_label, cursor) => {
    const db = fakeDb([]);
    await expect(service(db).listDeliveries({ cursor })).rejects.toBeInstanceOf(InvalidDeliveryCursorError);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('defaults to newest-first (order by occurred_at desc, id desc)', async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries();
    expect(rendered(db).sql).toMatch(/order by occurred_at desc, id desc/i);
  });

  it("honors order: 'asc' for a chronological read, including the cursor comparison direction", async () => {
    const db = fakeDb([]);
    await service(db).listDeliveries({ order: 'asc' });
    expect(rendered(db).sql).toMatch(/order by occurred_at asc, id asc/i);

    const cursor = encodeKeysetCursor(new Date('2026-06-01T10:00:00Z'), '5');
    const db2 = fakeDb([]);
    await service(db2).listDeliveries({ order: 'asc', cursor });
    expect(rendered(db2).sql).toMatch(/occurred_at >= \$\d+ and \(occurred_at > \$\d+ or id > \$\d+\)/i);
  });
});

describe('PostgresEventDeliveryObservabilityService.deliverySummary', () => {
  it('counts over the period on occurred_at, scoped to the application', async () => {
    const db = fakeDb([{ total: '8', delivered: '6', no_listeners: '1', dispatch_failed: '1', critical: '5', event_names: '3' }]);
    const since = new Date('2026-06-01T00:00:00Z');
    await expect(service(db).deliverySummary({ since })).resolves.toEqual({
      total: 8,
      delivered: 6,
      noListeners: 1,
      dispatchFailed: 1,
      critical: 5,
      eventNames: 3,
    });
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/application = \$1 and occurred_at >= \$2/i);
    expect(params).toEqual(['ascendra-pay', since]);
  });

  it('everything retained when no period is given; zeros on an empty table', async () => {
    const db = fakeDb([]);
    await expect(service(db).deliverySummary()).resolves.toMatchObject({ total: 0, noListeners: 0 });
    expect(rendered(db).sql).not.toMatch(/occurred_at >=/i);
  });
});

describe('PostgresEventDeliveryObservabilityService.deliveryCatalog', () => {
  it('per event over the period — by method and status, the last occurrence and its listener count', async () => {
    const db = fakeDb([
      {
        event_name: 'invoice.sent',
        total: '12',
        emit_count: '4',
        emit_critical_count: '8',
        no_listener_count: '3',
        dispatch_failed_count: '0',
        last_occurred_at: new Date('2026-06-01T10:00:00Z'),
        last_listener_count: 2,
      },
    ]);
    const since = new Date('2026-05-01T00:00:00Z');
    const entries = await service(db).deliveryCatalog({ since });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/group by event_name/i);
    expect(text).toMatch(/array_agg\(listener_count order by occurred_at desc, id desc\)/i);
    expect(params).toEqual(['ascendra-pay', since]);
    expect(entries).toEqual([
      {
        eventName: 'invoice.sent',
        total: 12,
        emitCount: 4,
        emitCriticalCount: 8,
        noListenerCount: 3,
        dispatchFailedCount: 0,
        lastOccurredAt: new Date('2026-06-01T10:00:00Z'),
        lastListenerCount: 2,
      },
    ]);
  });
});

describe('PostgresEventDeliveryObservabilityService.volume', () => {
  it("buckets 30 whole days in the viewer's zone, zero-filled, with the table's extent", async () => {
    const db = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ day: '2026-10-21', count: '7', no_listener_count: '2', dispatch_failed_count: '1' }] })
        .mockResolvedValueOnce({ rows: [{ oldest: new Date('2026-08-01T00:00:00Z'), total: '1234' }] })
        .mockResolvedValueOnce({ rows: [{ bytes: '81920' }] }),
    } satisfies SqlExecutor as SqlExecutor & { execute: ReturnType<typeof vi.fn> };

    const volume = await service(db).volume('Asia/Karachi', new Date('2026-10-21T21:30:00Z'));

    const perDay = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(perDay.sql).toMatch(/to_char\(occurred_at at time zone \$1, 'YYYY-MM-DD'\)/i);
    // 21:30 UTC is already the 22nd in Karachi — the 30 days end there.
    expect(perDay.params).toEqual(expect.arrayContaining(['ascendra-pay', '2026-09-23', 'Asia/Karachi']));
    expect(volume.perDay).toHaveLength(30);
    expect(volume.perDay[29]).toEqual({ day: '2026-10-22', count: 0, noListenerCount: 0, dispatchFailedCount: 0 });
    expect(volume.perDay[28]).toEqual({ day: '2026-10-21', count: 7, noListenerCount: 2, dispatchFailedCount: 1 });
    expect(volume).toMatchObject({ oldestOccurredAt: new Date('2026-08-01T00:00:00Z'), rowCount: 1234, tableSizeBytes: 81920 });
  });
});
