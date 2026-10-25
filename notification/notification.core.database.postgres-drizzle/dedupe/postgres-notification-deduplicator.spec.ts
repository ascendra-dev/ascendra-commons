import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresNotificationDeduplicator } from './postgres-notification-deduplicator';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const fakeDb = () => ({ execute: vi.fn() }) as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };

describe('PostgresNotificationDeduplicator', () => {
  it('claims atomically — insert, or take over an expired row; a returned row is the claim', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ dedupe_key: 'k' }] });
    await expect(new PostgresNotificationDeduplicator(db, 'ascendra-pay').claim('k', 86_400_000)).resolves.toEqual({ claimed: true });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/on conflict \(application, dedupe_key\) do update set/i);
    expect(text).toMatch(/where d\.expires_at < now\(\)/i);
    expect(params).toEqual(['ascendra-pay', 'k', 86_400_000]);
  });

  it("no row back — someone holds it: their stored result, or null while they're sending", async () => {
    const db = fakeDb();
    const prior = { status: 'sent', channels: {} };
    db.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ result: prior }] });
    await expect(new PostgresNotificationDeduplicator(db, 'a').claim('k', 1000)).resolves.toEqual({ claimed: false, prior });
    db.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ result: null }] });
    await expect(new PostgresNotificationDeduplicator(db, 'a').claim('k', 1000)).resolves.toEqual({ claimed: false, prior: null });
  });

  it('complete stores the result as jsonb', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    await new PostgresNotificationDeduplicator(db, 'a').complete('k', { status: 'sent', channels: {} });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/set result = \$1::jsonb/i);
    expect(params).toContain(JSON.stringify({ status: 'sent', channels: {} }));
  });
});
