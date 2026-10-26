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

  it('test=false shows real sends only, test=true test sends only', async () => {
    const db = fakeDb();
    await svc(db).getDeliveryHistory({ test: false });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/is_test = \$\d+/i);
    expect(params).toContain(false);
  });

  it("reason matches a code alone or with the provider's text after it — what byReason counts", async () => {
    const db = fakeDb();
    await svc(db).getDeliveryHistory({ reason: 'provider_timeout' });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/\(reason = \$\d+ or starts_with\(reason, \$\d+\)\)/i);
    expect(params).toEqual(expect.arrayContaining(['provider_timeout', 'provider_timeout:']));
  });

  it('statuses renders an IN list', async () => {
    const db = fakeDb();
    await svc(db).getDeliveryHistory({ statuses: ['failed', 'bounced'] });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/status in \(\$\d+, \$\d+\)/i);
    expect(params).toEqual(expect.arrayContaining(['failed', 'bounced']));
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
    expect(text).not.toMatch(/is_test =/i);
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
  it("with the fallback on, a tenant route with no own credential isn't a gap when the platform has one", async () => {
    const route = (text: string) => {
      if (/from commons_notification_channel_route/i.test(text)) return [{ notification_type: 'x', tenant_id: 't1', channels: ['email'] }];
      if (/from commons_notification_template/i.test(text)) return [{ channel: 'email', notification_type: 'x', tenant_id: null }];
      if (/from commons_notification_provider_credential/i.test(text)) return [{ channel: 'email', tenant_id: null }];
      return [];
    };
    const without = await new PostgresNotificationObservabilityService(fakeDb(route), 'ascendra-pay').configCoverageGaps();
    expect(without).toEqual([{ notificationType: 'x', tenantId: 't1', channel: 'email', kind: 'missing_provider_credential' }]);
    const withFallback = await new PostgresNotificationObservabilityService(fakeDb(route), 'ascendra-pay', true).configCoverageGaps();
    expect(withFallback).toEqual([]);
  });

  describe('a default route, across tenants', () => {
    const config = (creds: Array<{ channel: string; tenant_id: string | null }>, extraRoutes: unknown[] = []) => (text: string) => {
      if (/from commons_notification_channel_route/i.test(text)) {
        return [{ notification_type: 'invoice.sent', tenant_id: null, channels: ['email', 'sms'] }, ...extraRoutes];
      }
      if (/from commons_notification_template/i.test(text)) {
        return [
          { channel: 'email', notification_type: 'invoice.sent', tenant_id: null },
          { channel: 'sms', notification_type: 'invoice.sent', tenant_id: null },
        ];
      }
      if (/from commons_notification_provider_credential/i.test(text)) return creds;
      return [];
    };

    it('each tenant the directory names needs an account on each channel the default routes it to', async () => {
      const db = fakeDb(config([{ channel: 'email', tenant_id: 't1' }, { channel: 'sms', tenant_id: 't1' }, { channel: 'email', tenant_id: 't2' }]));
      const gaps = await svc(db).configCoverageGaps(undefined, ['t1', 't2', 't3']);
      expect(gaps).toEqual([
        { notificationType: 'invoice.sent', tenantId: 't2', channel: 'sms', kind: 'missing_provider_credential' },
        { notificationType: 'invoice.sent', tenantId: 't3', channel: 'email', kind: 'missing_provider_credential' },
        { notificationType: 'invoice.sent', tenantId: 't3', channel: 'sms', kind: 'missing_provider_credential' },
      ]);
    });

    it("a tenant with its own route for the type isn't checked against the default", async () => {
      const db = fakeDb(config([{ channel: 'email', tenant_id: 't1' }], [{ notification_type: 'invoice.sent', tenant_id: 't1', channels: ['email'] }]));
      const gaps = await svc(db).configCoverageGaps(undefined, ['t1']);
      expect(gaps.filter((g) => g.kind === 'missing_provider_credential')).toEqual([]);
    });

    it('without a directory: the tenants the config names', async () => {
      const db = fakeDb(config([{ channel: 'email', tenant_id: 't1' }, { channel: 'sms', tenant_id: 't1' }, { channel: 'email', tenant_id: 't2' }]));
      const gaps = await svc(db).configCoverageGaps();
      expect(gaps.map((g) => `${g.tenantId}:${g.channel}`)).toEqual(['t2:sms']);
    });

    it("the platform's account covers every tenant when the fallback is on", async () => {
      const db = fakeDb(config([{ channel: 'email', tenant_id: null }, { channel: 'sms', tenant_id: null }]));
      const gaps = await new PostgresNotificationObservabilityService(db, 'ascendra-pay', true).configCoverageGaps(undefined, ['t1', 't2']);
      expect(gaps).toEqual([]);
    });

    it("a tenant admin's check covers their own tenant only", async () => {
      const db = fakeDb(config([]));
      const gaps = await svc(db).configCoverageGaps({ tenantId: 't1' });
      expect(new Set(gaps.map((g) => g.tenantId))).toEqual(new Set(['t1']));
    });
  });

  it('in-app needs no provider credential — the app is the provider', async () => {
    const db = fakeDb((text) => {
      if (/from commons_notification_channel_route/i.test(text)) return [{ notification_type: 'x', tenant_id: null, channels: ['in_app'] }];
      if (/from commons_notification_template/i.test(text)) return [{ channel: 'in_app', notification_type: 'x', tenant_id: null }];
      return [];
    });
    expect(await svc(db).configCoverageGaps(undefined, ['t1'])).toEqual([]);
  });

  it("WhatsApp needs no template row — its templates live on Meta's side", async () => {
    const db = fakeDb((text) =>
      /from commons_notification_channel_route/i.test(text) ? [{ notification_type: 'x', tenant_id: null, channels: ['whatsapp'] }] : [],
    );
    expect(await svc(db).configCoverageGaps(undefined, [])).toEqual([]);
  });

  it('scoped: every query reads only the defaults and that tenant', async () => {
    const db = fakeDb();
    await svc(db).configCoverageGaps({ tenantId: 't1' });
    expect(db.execute).toHaveBeenCalledTimes(3);
    for (const call of db.execute.mock.calls) {
      const { sql: text, params } = dialect.sqlToQuery(call[0] as SQL);
      expect(text).toMatch(/\(tenant_id is null or tenant_id = \$\d+\)/i);
      expect(params).toContain('t1');
    }
  });

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
    // invoice.sent/email has a (null-tenant) template → not a template gap
    expect(gaps).not.toContainEqual(expect.objectContaining({ notificationType: 'invoice.sent', channel: 'email', kind: 'missing_template' }));
    // …but the default route also serves t1 (the config names it), which has no email account
    expect(gaps).toContainEqual({ notificationType: 'invoice.sent', tenantId: 't1', channel: 'email', kind: 'missing_provider_credential' });
  });
});

describe('getDeliveryStats', () => {
  it('groups by channel/status, type/status and day, scoped to the application and window', async () => {
    const db = fakeDb((text) => {
      if (/group by channel, status/i.test(text)) return [{ channel: 'email', status: 'sent', count: 5 }];
      if (/group by notification_type, status/i.test(text)) return [{ notification_type: 'invoice.sent', status: 'sent', count: 5 }];
      if (/as day/i.test(text)) return [{ day: '2026-06-01', count: 5, failed: 2 }];
      if (/as reason/i.test(text)) return [{ status: 'failed', reason: 'provider_auth_failed', count: 13 }, { status: 'bounced', reason: 'bounced', count: 2 }];
      return [];
    });
    const since = new Date('2026-05-25T00:00:00Z');
    const until = new Date('2026-06-01T00:00:00Z');
    const stats = await svc(db).getDeliveryStats({ since, until, tenantId: 't1' });

    expect(stats.since).toEqual(since);
    expect(stats.until).toEqual(until);
    expect(stats.byChannel).toEqual([{ channel: 'email', status: 'sent', count: 5 }]);
    expect(stats.byType).toEqual([{ notificationType: 'invoice.sent', status: 'sent', count: 5 }]);
    expect(stats.byDay).toEqual([{ day: '2026-06-01', count: 5, failed: 2 }]);
    expect(stats.byReason).toEqual([
      { status: 'failed', reason: 'provider_auth_failed', count: 13 },
      { status: 'bounced', reason: 'bounced', count: 2 },
    ]);
    const reasonQuery = db.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL)).find((q) => /as reason/i.test(q.sql))!;
    expect(reasonQuery.sql).toMatch(/split_part\(reason, ':', 1\)/i);
    expect(reasonQuery.sql).toMatch(/status in \('failed', 'skipped', 'bounced'\)/i);

    for (const call of db.execute.mock.calls) {
      const { sql: text, params } = dialect.sqlToQuery(call[0] as SQL);
      expect(params).toEqual(expect.arrayContaining(['ascendra-pay', since, until, 't1']));
      // a test send checks config — it isn't deliverability
      expect(text).toMatch(/not is_test/i);
    }
  });

  it("a day window: whole calendar days in the viewer's zone, every day listed, a quiet one at 0", async () => {
    const db = fakeDb((text) => {
      if (/as since/i.test(text)) return [{ since: new Date('2026-05-29T19:00:00Z') }];
      if (/as day/i.test(text)) return [{ day: '2026-06-01', count: 3, failed: 1 }];
      return [];
    });
    const now = new Date('2026-06-01T12:00:00Z');
    const stats = await svc(db).getDeliveryStats({ days: 3, timeZone: 'Asia/Karachi' }, now);
    expect(stats.since).toEqual(new Date('2026-05-29T19:00:00Z'));
    expect(stats.byDay).toEqual([
      { day: '2026-05-30', count: 0, failed: 0 },
      { day: '2026-05-31', count: 0, failed: 0 },
      { day: '2026-06-01', count: 3, failed: 1 },
    ]);
    const first = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(first.sql).toMatch(/::date::timestamp at time zone \$\d+\) as since/i);
    expect(first.params).toEqual(['2026-05-30', 'Asia/Karachi']);
    const byDay = db.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL)).find((q) => /as day/i.test(q.sql))!;
    expect(byDay.sql).toMatch(/to_char\(attempted_at at time zone \$\d+, 'YYYY-MM-DD'\)/i);
    expect(byDay.params).toContain('Asia/Karachi');
  });

  it('defaults to a 7-day window ending now when none is given', async () => {
    const db = fakeDb(() => []);
    const before = Date.now();
    const stats = await svc(db).getDeliveryStats();
    expect(stats.until.getTime()).toBeGreaterThanOrEqual(before);
    expect(stats.until.getTime() - stats.since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('volume', () => {
  it("30 calendar days in the viewer's zone, the table's extent and what still holds content", async () => {
    const db = fakeDb((text) => {
      if (/group by 1/i.test(text)) return [{ day: '2026-06-01', deliveries: 9, failed: 2, with_content: 4 }];
      if (/min\(attempted_at\)/i.test(text)) {
        return [{ oldest: new Date('2026-03-01T00:00:00Z'), total: '120', with_content: '40', oldest_content: new Date('2026-05-02T00:00:00Z') }];
      }
      if (/pg_total_relation_size/i.test(text)) return [{ bytes: '65536' }];
      return [];
    });
    const v = await svc(db).volume('Asia/Dubai', new Date('2026-06-01T12:00:00Z'));
    expect(v).toMatchObject({
      oldestAttemptedAt: new Date('2026-03-01T00:00:00Z'),
      rowCount: 120,
      contentRowCount: 40,
      oldestContentAt: new Date('2026-05-02T00:00:00Z'),
      tableSizeBytes: 65536,
    });
    expect(v.perDay).toHaveLength(30);
    expect(v.perDay[0]).toEqual({ day: '2026-05-03', deliveries: 0, failed: 0, withContent: 0 });
    expect(v.perDay[29]).toEqual({ day: '2026-06-01', deliveries: 9, failed: 2, withContent: 4 });
    const perDay = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(perDay.params).toEqual(expect.arrayContaining(['Asia/Dubai', 'ascendra-pay', '2026-05-03']));
  });
});
