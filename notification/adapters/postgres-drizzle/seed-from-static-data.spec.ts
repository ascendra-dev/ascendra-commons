import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { seedNotificationConfigFromData } from './seed-from-static-data';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

const rendered = (db: ReturnType<typeof fakeDb>) =>
  db.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL));

describe('seedNotificationConfigFromData', () => {
  it('writes channels/templates as deployment-default (tenant_id NULL) rows and credentials by tenant', async () => {
    const db = fakeDb();
    await seedNotificationConfigFromData(db, {
      channels: { 'invoice.sent': ['email'] },
      templates: { email: { 'invoice.sent': { subject: 'S', body: 'B', isHtml: true } } },
      providerConfigs: { email: { 't1': { apiKey: 'k', from: 'b@e.com', fromName: 'Billing' } } },
    });

    const all = rendered(db);
    const route = all.find((q) => q.sql.includes('notification_channel_route'))!;
    expect(route.sql).toMatch(/INSERT INTO notification_channel_route/i);
    expect(route.sql).toMatch(/VALUES \(\$\d+, NULL, ARRAY\[/i);
    expect(route.sql).toMatch(/ON CONFLICT ON CONSTRAINT notification_channel_route_uq/i);

    const tpl = all.find((q) => q.sql.includes('notification_template'))!;
    expect(tpl.sql).toMatch(/VALUES \(\$\d+, \$\d+, NULL, /i);
    expect(tpl.params).toContain('S');
    expect(tpl.params).toContain('B');

    const cred = all.find((q) => q.sql.includes('notification_provider_credential'))!;
    expect(cred.params).toContain('t1');
    expect(cred.params).toContain('k');
  });

  it('omits templates/providerConfigs cleanly when not provided', async () => {
    const db = fakeDb();
    await seedNotificationConfigFromData(db, { channels: { 'invoice.sent': ['email'] } });

    const all = rendered(db);
    expect(all).toHaveLength(1);
    expect(all[0].sql).toMatch(/notification_channel_route/);
  });
});
