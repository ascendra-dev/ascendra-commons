import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationConfigAdminService } from './postgres-notification-config-admin.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}
const rendered = (db: ReturnType<typeof fakeDb>) => dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
const svc = (db: SqlExecutor) => new PostgresNotificationConfigAdminService(db, 'ascendra-pay');

describe('PostgresNotificationConfigAdminService', () => {
  it('setChannelRoute upserts on the route unique constraint, application stamped', async () => {
    const db = fakeDb();
    await svc(db).setChannelRoute({ notificationType: 'invoice.sent', tenantId: null, channels: ['email', 'sms'] });
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_notification_channel_route/i);
    expect(text).toMatch(/on conflict on constraint commons_notification_channel_route_uq/i);
    expect(text).toMatch(/array\[.*\]::text\[\]/is);
    expect(params).toEqual(expect.arrayContaining(['ascendra-pay', 'invoice.sent', 'email', 'sms']));
  });

  it('deleteTemplate scopes by tenant_id IS NULL for a deployment-default row', async () => {
    const db = fakeDb();
    await svc(db).deleteTemplate({ channel: 'email', notificationType: 'invoice.sent', tenantId: null });
    const { sql: text } = rendered(db);
    expect(text).toMatch(/delete from commons_notification_template/i);
    expect(text).toMatch(/tenant_id is null/i);
  });

  it('setProviderCredential upserts on the PK and binds config as jsonb', async () => {
    const db = fakeDb();
    await svc(db).setProviderCredential({ channel: 'email', tenantId: 't1', config: { apiKey: 'k', region: 'ap' } });
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/insert into commons_notification_provider_credential/i);
    expect(text).toMatch(/on conflict \(application, channel, tenant_id\)/i);
    expect(text).toMatch(/::jsonb/i);
    expect(params).toContain(JSON.stringify({ apiKey: 'k', region: 'ap' }));
  });

  it('listProviderCredentials returns only (channel, tenant) pairs — never the config blob', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ channel: 'email', tenant_id: 't1' }] });
    const list = await svc(db).listProviderCredentials();
    expect(list).toEqual([{ channel: 'email', tenantId: 't1' }]);
    expect(rendered(db).sql).not.toMatch(/config/i);
  });

  it.each([
    ['listChannelRoutes', 'commons_notification_channel_route'],
    ['listTemplates', 'commons_notification_template'],
  ] as const)('%s scoped to a tenant: the defaults plus that tenant, bound', async (method, table) => {
    const db = fakeDb();
    await svc(db)[method]({ tenantId: 't1' });
    const { sql: text, params } = rendered(db);
    expect(text).toContain(table);
    expect(text).toMatch(/\(tenant_id is null or tenant_id = \$\d+\)/i);
    expect(params).toEqual(['ascendra-pay', 't1']);
  });

  it('listProviderCredentials scoped to a tenant: that tenant only', async () => {
    const db = fakeDb();
    await svc(db).listProviderCredentials({ tenantId: 't1' });
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/tenant_id = \$\d+/i);
    expect(text).not.toMatch(/tenant_id is null/i);
    expect(params).toEqual(['ascendra-pay', 't1']);
  });

  it('unscoped lists filter by application only', async () => {
    const db = fakeDb();
    await svc(db).listTemplates();
    expect(rendered(db).sql).not.toMatch(/tenant_id = /i);
  });
});
