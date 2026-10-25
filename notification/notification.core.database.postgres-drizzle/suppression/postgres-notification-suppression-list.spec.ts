import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationSuppressionList } from './postgres-notification-suppression-list';
import { ConfigCache } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const fakeDb = (rows: unknown[]) =>
  ({ execute: vi.fn().mockResolvedValue({ rows }) }) as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };

describe('PostgresNotificationSuppressionList', () => {
  it('one lookup on the unique key, bound — and cached', async () => {
    const db = fakeDb([{ '?column?': 1 }]);
    const list = new PostgresNotificationSuppressionList(db, 'ascendra-pay', {});
    await expect(list.isSuppressed('email', 'h:abc')).resolves.toBe(true);
    await expect(list.isSuppressed('email', 'h:abc')).resolves.toBe(true);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_notification_suppression/i);
    expect(params).toEqual(['ascendra-pay', 'email', 'h:abc']);
  });

  it('an entry removed through the admin API is seen at once (the caches are emptied)', async () => {
    const db = fakeDb([{ '?column?': 1 }]);
    const list = new PostgresNotificationSuppressionList(db, 'a', {});
    await list.isSuppressed('sms', 'user:u1');
    db.execute.mockResolvedValue({ rows: [] });
    ConfigCache.invalidateAll();
    await expect(list.isSuppressed('sms', 'user:u1')).resolves.toBe(false);
  });
});
