import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationConfig } from './postgres-notification-config';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const OPTIONS = { application: 'ascendra-pay', cacheTtlSeconds: 0 };

function fakeDb(byTable: { route?: unknown[]; template?: unknown[]; credential?: unknown[] } = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes('commons_notification_channel_route')) return { rows: byTable.route ?? [] };
    if (text.includes('commons_notification_template')) return { rows: byTable.template ?? [] };
    if (text.includes('commons_notification_provider_credential')) return { rows: byTable.credential ?? [] };
    return { rows: [] };
  });
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe('PostgresNotificationConfig', () => {
  describe('channelsFor', () => {
    it('returns the channels of the winning row', async () => {
      const db = fakeDb({ route: [{ channels: ['email', 'sms'] }] });
      await expect(new PostgresNotificationConfig(db, OPTIONS).channelsFor('invoice.sent', 't1')).resolves.toEqual([
        'email',
        'sms',
      ]);
    });

    it('returns [] when no row matches', async () => {
      const db = fakeDb({ route: [] });
      await expect(new PostgresNotificationConfig(db, OPTIONS).channelsFor('x', null)).resolves.toEqual([]);
    });

    it('orders tenant-specific rows before the deployment default', async () => {
      const db = fakeDb({ route: [{ channels: ['email'] }] });
      await new PostgresNotificationConfig(db, OPTIONS).channelsFor('invoice.sent', 't1');

      const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
      expect(text).toMatch(/ORDER BY tenant_id IS NULL/i);
      expect(text).toMatch(/tenant_id = \$\d+ OR tenant_id IS NULL/i);
      expect(text).toMatch(/application = \$\d+/i);
      expect(params).toContain('ascendra-pay');
    });
  });

  describe('templateFor', () => {
    it('maps a row to NotificationTemplate, null subject → undefined', async () => {
      const db = fakeDb({ template: [{ subject: null, body: 'Pay {{amount}}', is_html: false }] });
      await expect(
        new PostgresNotificationConfig(db, OPTIONS).templateFor('sms', 'payment.overdue.reminder', 't1'),
      ).resolves.toEqual({ subject: undefined, body: 'Pay {{amount}}', isHtml: false });
    });

    it('returns null when no template row matches', async () => {
      const db = fakeDb({ template: [] });
      await expect(new PostgresNotificationConfig(db, OPTIONS).templateFor('email', 'x', null)).resolves.toBeNull();
    });
  });

  describe('providerConfigFor', () => {
    it('returns the config jsonb verbatim — whatever shape the row holds', async () => {
      const db = fakeDb({ credential: [{ config: { accessKeyId: 'A', secretAccessKey: 'S', region: 'eu-west-1' } }] });
      await expect(new PostgresNotificationConfig(db, OPTIONS).providerConfigFor('email', 't1')).resolves.toEqual({
        accessKeyId: 'A',
        secretAccessKey: 'S',
        region: 'eu-west-1',
      });
    });

    it("a tenantless send reads the platform's account — the tenant_id NULL row", async () => {
      const db = fakeDb({ credential: [{ config: { apiKey: 'platform' } }] });
      await expect(new PostgresNotificationConfig(db, OPTIONS).providerConfigFor('email', null)).resolves.toEqual({ apiKey: 'platform' });
      const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
      expect(text).toMatch(/AND tenant_id IS NULL/i);
    });

    it('returns null when no credential row exists for that tenant', async () => {
      const db = fakeDb({ credential: [] });
      await expect(new PostgresNotificationConfig(db, OPTIONS).providerConfigFor('email', 'unknown')).resolves.toBeNull();
    });

    it("by default a tenant reads its own account only — never the platform's", async () => {
      const db = fakeDb({ credential: [] });
      await new PostgresNotificationConfig(db, OPTIONS).providerConfigFor('email', 't1');
      const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
      expect(text).toMatch(/AND tenant_id = \$\d+/i);
      expect(text).not.toMatch(/tenant_id IS NULL\)/i);
    });

    it("with tenantCredentialFallback, a tenant's own row first, then the platform's — never another tenant's", async () => {
      const db = fakeDb({ credential: [{ config: { apiKey: 'platform' } }] });
      const config = new PostgresNotificationConfig(db, { ...OPTIONS, tenantCredentialFallback: true });
      await config.providerConfigFor('email', 't1');
      const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
      expect(text).toMatch(/\(tenant_id = \$\d+ OR tenant_id IS NULL\)/i);
      expect(text).toMatch(/ORDER BY tenant_id IS NULL/i);
      expect(params).toContain('t1');
    });
  });

  describe('caching', () => {
    it('with a non-zero TTL, repeated lookups for the same key query once', async () => {
      const db = fakeDb({ route: [{ channels: ['email'] }] });
      const config = new PostgresNotificationConfig(db, { application: 'ascendra-pay', cacheTtlSeconds: 30 });

      await config.channelsFor('invoice.sent', 't1');
      await config.channelsFor('invoice.sent', 't1');

      expect(db.execute).toHaveBeenCalledTimes(1);
    });

    it('different args are cached separately', async () => {
      const db = fakeDb({ route: [{ channels: ['email'] }] });
      const config = new PostgresNotificationConfig(db, { application: 'ascendra-pay', cacheTtlSeconds: 30 });

      await config.channelsFor('invoice.sent', 't1');
      await config.channelsFor('invoice.sent', 't2');

      expect(db.execute).toHaveBeenCalledTimes(2);
    });
  });
});
