import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationObservabilityService } from './postgres-notification-observability.service';
import { decodeKeysetCursor, encodeKeysetCursor, InvalidDeliveryCursorError } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(route: (text: string) => unknown[] = () => []) {
  const execute = vi.fn(async (q: SQL) => ({ rows: route(dialect.sqlToQuery(q).sql) }));
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}
const svc = (db: SqlExecutor) => new PostgresNotificationObservabilityService(db, 'ascendra-pay');

let seq = 0;
function deliveryRow(over: Partial<Record<string, unknown>> = {}) {
  seq += 1;
  return {
    id: seq,
    notification_type: 'invoice.sent',
    channel: 'email',
    tenant_id: 't1',
    recipient_ref: 'user:u1',
    status: 'sent',
    reason: null,
    provider_message_id: null,
    attempted_at: new Date('2026-06-01T08:00:00Z'),
    updated_at: new Date('2026-06-01T08:00:00Z'),
    correlation_id: null,
    ...over,
  };
}

describe('getDeliveryHistory', () => {
  it('scopes to the application, maps rows, and paginates', async () => {
    const many = Array.from({ length: 51 }, (_, i) => deliveryRow({ id: 100 + i }));
    const db = fakeDb((text) => (/from commons_notification_delivery/i.test(text) ? many : []));
    const page = await svc(db).getDeliveryHistory({ limit: 50 });

    expect(page.deliveries).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
    expect(page.deliveries[0]).toMatchObject({ notificationType: 'invoice.sent', channel: 'email', status: 'sent' });
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toContain('ascendra-pay');
  });

  it("the next cursor carries the last row's microsecond key and id", async () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      deliveryRow({ id: 200 + i, attempted_at_key: `2026-06-01T08:00:00.00012${i}Z` }),
    );
    const db = fakeDb((text) => (/from commons_notification_delivery/i.test(text) ? many : []));
    const page = await svc(db).getDeliveryHistory({ limit: 2 });
    expect(decodeKeysetCursor(page.nextCursor!)).toEqual({ timestamp: '2026-06-01T08:00:00.000121Z', id: '201' });
  });

  it('a cursor leads with the indexed column and binds both parts', async () => {
    const db = fakeDb();
    await svc(db).getDeliveryHistory({ cursor: encodeKeysetCursor('2026-06-01T08:00:00.000121Z', '201') });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/attempted_at <= \$\d+::timestamptz and \(attempted_at < \$\d+::timestamptz or id < \$\d+::bigint\)/i);
    expect(params).toEqual(expect.arrayContaining(['2026-06-01T08:00:00.000121Z', '201']));
  });

  it('a cursor it never issued is an error — never page one again', async () => {
    const db = fakeDb();
    await expect(svc(db).getDeliveryHistory({ cursor: 'garbage' })).rejects.toBeInstanceOf(InvalidDeliveryCursorError);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('renders the optional filters as bound params', async () => {
    const db = fakeDb();
    await svc(db).getDeliveryHistory({
      notificationType: 'invoice.sent', channel: 'sms', tenantId: 't9',
      recipientRef: 'user:u5', status: 'bounced', since: new Date('2026-01-01T00:00:00Z'),
    });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/notification_type =/i);
    expect(text).toMatch(/recipient_ref =/i);
    expect(text).toMatch(/attempted_at >=/i);
    expect(params).toEqual(expect.arrayContaining(['invoice.sent', 'sms', 't9', 'user:u5', 'bounced']));
  });
});

describe('getDelivery', () => {
  it('returns one row scoped to the application and id', async () => {
    const db = fakeDb((text) =>
      /from commons_notification_delivery/i.test(text) ? [deliveryRow({ id: 42, tenant_id: 't1' })] : [],
    );
    const record = await svc(db).getDelivery('42');
    expect(record).toMatchObject({ id: '42', tenantId: 't1', notificationType: 'invoice.sent' });
    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', '42']));
  });

  it('returns null when no row matches', async () => {
    const db = fakeDb(() => []);
    expect(await svc(db).getDelivery('999')).toBeNull();
  });

  it('an id that is not a delivery id is not found — no query (::bigint would fail it)', async () => {
    const db = fakeDb();
    expect(await svc(db).getDelivery('nd_71A2')).toBeNull();
    expect(await svc(db).getDeliveryContent('99999999999999999999')).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('getDeliveryContent', () => {
  it('returns the stored content for one row, application-scoped', async () => {
    const content = { subject: 'Hi', body: 'You owe 40', isHtml: false, variables: { amount: 40 } };
    const db = fakeDb((text) =>
      /select id, notification_type, channel, recipient_ref, attempted_at, content/i.test(text)
        ? [{ id: 7, notification_type: 'invoice.sent', channel: 'email', recipient_ref: 'user:u1', attempted_at: new Date('2026-06-01T08:00:00Z'), content }]
        : [],
    );
    const rec = await svc(db).getDeliveryContent('7');
    expect(rec).toMatchObject({ id: '7', channel: 'email', content });
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toEqual(expect.arrayContaining(['ascendra-pay', '7']));
  });

  it('returns null when the row has no stored content', async () => {
    const db = fakeDb(() => [{ id: 7, notification_type: 'x', channel: 'email', recipient_ref: 'r', attempted_at: new Date(), content: null }]);
    expect(await svc(db).getDeliveryContent('7')).toBeNull();
  });
});

describe('configCoverageGaps', () => {
  it('flags a routed channel with no template and a tenant route with no provider credential', async () => {
    const db = fakeDb((text) => {
      if (/from commons_notification_channel_route/i.test(text)) {
        return [
          { notification_type: 'invoice.sent', tenant_id: null, channels: ['email', 'sms'] },
          { notification_type: 'payment.confirmed', tenant_id: 't1', channels: ['email'] },
        ];
      }
      if (/from commons_notification_template/i.test(text)) {
        // email templates exist for both; no sms template anywhere
        return [
          { channel: 'email', notification_type: 'invoice.sent', tenant_id: null },
          { channel: 'email', notification_type: 'payment.confirmed', tenant_id: null },
        ];
      }
      if (/from commons_notification_provider_credential/i.test(text)) return []; // no credentials at all
      return [];
    });

    const gaps = await svc(db).configCoverageGaps();

    expect(gaps).toContainEqual({ notificationType: 'invoice.sent', tenantId: null, channel: 'sms', kind: 'missing_template' });
    expect(gaps).toContainEqual({ notificationType: 'payment.confirmed', tenantId: 't1', channel: 'email', kind: 'missing_provider_credential' });
    // invoice.sent/email has a (null-tenant) template → not a gap; null-tenant route needs no credential
    expect(gaps).not.toContainEqual(expect.objectContaining({ notificationType: 'invoice.sent', channel: 'email' }));
  });
});

describe('getDeliveryStats', () => {
  it('groups by channel/status, type/status and day, scoped to the application and window', async () => {
    const db = fakeDb((text) => {
      if (/group by channel, status/i.test(text)) return [{ channel: 'email', status: 'sent', count: 5 }];
      if (/group by notification_type, status/i.test(text)) return [{ notification_type: 'invoice.sent', status: 'sent', count: 5 }];
      if (/group by day/i.test(text)) return [{ day: new Date('2026-06-01T00:00:00Z'), count: 5 }];
      return [];
    });
    const since = new Date('2026-05-25T00:00:00Z');
    const until = new Date('2026-06-01T00:00:00Z');
    const stats = await svc(db).getDeliveryStats({ since, until, tenantId: 't1' });

    expect(stats.since).toEqual(since);
    expect(stats.until).toEqual(until);
    expect(stats.byChannel).toEqual([{ channel: 'email', status: 'sent', count: 5 }]);
    expect(stats.byType).toEqual([{ notificationType: 'invoice.sent', status: 'sent', count: 5 }]);
    expect(stats.byDay).toEqual([{ day: '2026-06-01', count: 5 }]);

    for (const call of db.execute.mock.calls) {
      const { params } = dialect.sqlToQuery(call[0] as SQL);
      expect(params).toEqual(expect.arrayContaining(['ascendra-pay', since, until, 't1']));
    }
  });

  it('defaults to a 7-day window ending now when none is given', async () => {
    const db = fakeDb(() => []);
    const before = Date.now();
    const stats = await svc(db).getDeliveryStats();
    expect(stats.until.getTime()).toBeGreaterThanOrEqual(before);
    expect(stats.until.getTime() - stats.since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
