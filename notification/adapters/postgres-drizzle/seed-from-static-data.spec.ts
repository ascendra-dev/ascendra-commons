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
  it('writes channels/templates as deployment-default (tenant_id NULL) rows for the application, credentials by tenant', async () => {
    const db = fakeDb();
    await seedNotificationConfigFromData(db, 'ascendra-pay', {
      channels: { 'invoice.sent': ['email'] },
      templates: { email: { 'invoice.sent': { subject: 'S', body: 'B', isHtml: true } } },
      providerConfigs: { email: { 't1': { accessKeyId: 'A', secretAccessKey: 'S', region: 'eu' } } },
    });

    const all = rendered(db);
    const route = all.find((q) => q.sql.includes('commons_notification_channel_route'))!;
    expect(route.sql).toMatch(/INSERT INTO commons_notification_channel_route \(application, notification_type, tenant_id, channels\)/i);
    expect(route.sql).toMatch(/VALUES \(\$\d+, \$\d+, NULL, ARRAY\[/i);
    expect(route.sql).toMatch(/ON CONFLICT \(application, notification_type, tenant_id\)/i);
    expect(route.params).toContain('ascendra-pay');

    const tpl = all.find((q) => q.sql.includes('commons_notification_template'))!;
    expect(tpl.params).toContain('S');
    expect(tpl.params).toContain('B');

    const cred = all.find((q) => q.sql.includes('commons_notification_provider_credential'))!;
    expect(cred.sql).toMatch(/\(application, channel, tenant_id, config\)/i);
    expect(cred.sql).toMatch(/::jsonb/i);
    expect(cred.params).toContain('t1');
    expect(cred.params).toContain('ascendra-pay');
    expect(cred.params).toContain(JSON.stringify({ accessKeyId: 'A', secretAccessKey: 'S', region: 'eu' }));
  });

  it('omits templates/providerConfigs cleanly when not provided', async () => {
    const db = fakeDb();
    await seedNotificationConfigFromData(db, 'ascendra-pay', { channels: { 'invoice.sent': ['email'] } });

    const all = rendered(db);
    expect(all).toHaveLength(1);
    expect(all[0].sql).toMatch(/commons_notification_channel_route/);
  });
});
