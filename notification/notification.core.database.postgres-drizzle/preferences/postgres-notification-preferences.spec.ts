import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationPreferences } from './postgres-notification-preferences';
import { ConfigCache } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const fakeDb = (rows: unknown[] = []) =>
  ({ execute: vi.fn().mockResolvedValue({ rows }) }) as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
const row = (notification_type: string, channel: string, enabled: boolean) => ({ notification_type, channel, enabled, updated_at: new Date() });

describe('PostgresNotificationPreferences', () => {
  it("reads a user's rules once, cached — and applies the most specific", async () => {
    const db = fakeDb([row('*', 'sms', false), row('invoice.sent', 'sms', true)]);
    const prefs = new PostgresNotificationPreferences(db, 'ascendra-pay');
    await expect(prefs.isOptedOut('u1', 'invoice.reminder', 'sms')).resolves.toBe(true);
    await expect(prefs.isOptedOut('u1', 'invoice.sent', 'sms')).resolves.toBe(false);
    await expect(prefs.isOptedOut('u1', 'invoice.sent', 'email')).resolves.toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).params).toEqual(['ascendra-pay', 'u1']);
  });

  it('setRule upserts and empties the caches — the next send sees it', async () => {
    const invalidate = vi.spyOn(ConfigCache, 'invalidateAll');
    const db = fakeDb();
    await new PostgresNotificationPreferences(db, 'a').setRule('u1', { notificationType: '*', channel: 'sms', enabled: false });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/on conflict \(application, user_id, notification_type, channel\) do update/i);
    expect(params).toEqual(['a', 'u1', '*', 'sms', false]);
    expect(invalidate).toHaveBeenCalled();
    invalidate.mockRestore();
  });
});
