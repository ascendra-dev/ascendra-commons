import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationInbox } from './postgres-notification-inbox';
import { decodeKeysetCursor, InvalidDeliveryCursorError } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const fakeDb = (rows: unknown[] = []) =>
  ({ execute: vi.fn().mockResolvedValue({ rows }) }) as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
const q = (db: ReturnType<typeof fakeDb>, i = 0) => dialect.sqlToQuery(db.execute.mock.calls[i][0] as SQL);

describe('PostgresNotificationInbox', () => {
  it('delivers a cleaned row and returns its id', async () => {
    const db = fakeDb([{ id: 42 }]);
    await expect(
      new PostgresNotificationInbox(db, 'a').deliver({ userId: 'u1', tenantId: 't1', notificationType: 'x', title: 'Hi\u0000', body: 'b', correlationId: 'bad id' }),
    ).resolves.toBe('42');
    expect(q(db).params).toEqual(['a', 't1', 'u1', 'x', 'Hi', 'b', null]);
  });

  it("every read is one user in one tenant — a tenantless user's too", async () => {
    const db = fakeDb();
    const inbox = new PostgresNotificationInbox(db, 'a');
    await inbox.list('u1', 't1', { unreadOnly: true });
    expect(q(db, 0).sql).toMatch(/user_id = \$2 and tenant_id = \$3 and read_at is null/i);
    await inbox.unreadCount('p1', null);
    expect(q(db, 1).sql).toMatch(/user_id = \$2 and tenant_id is null/i);
  });

  it('pages newest first with a microsecond cursor; a foreign cursor is an error', async () => {
    const rows = [1, 2, 3].map((i) => ({ id: i, notification_type: 'x', title: null, body: 'b', created_at: new Date(), read_at: null, created_at_key: `2026-06-01T00:00:00.00000${i}Z` }));
    const db = fakeDb(rows);
    const page = await new PostgresNotificationInbox(db, 'a').list('u1', 't1', { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(decodeKeysetCursor(page.nextCursor!)).toEqual({ timestamp: '2026-06-01T00:00:00.000002Z', id: '2' });
    await expect(new PostgresNotificationInbox(fakeDb(), 'a').list('u1', 't1', { cursor: 'junk' })).rejects.toBeInstanceOf(InvalidDeliveryCursorError);
  });

  it("marking: only one's own item; a non-numeric id touches nothing", async () => {
    const db = fakeDb([{ id: 7 }]);
    const inbox = new PostgresNotificationInbox(db, 'a');
    await expect(inbox.markRead('u1', 't1', '7')).resolves.toBe(true);
    expect(q(db).sql).toMatch(/set read_at = coalesce\(read_at, now\(\)\)/i);
    expect(q(db).sql).toMatch(/user_id = \$2/i);
    await expect(inbox.markRead('u1', 't1', 'x7')).resolves.toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
