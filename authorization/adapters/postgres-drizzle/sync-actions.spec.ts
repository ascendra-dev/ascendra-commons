import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { syncActions } from './sync-actions';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe('syncActions', () => {
  it('does nothing for an empty list', async () => {
    const db = fakeDb();
    await syncActions(db, []);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('inserts keys with ON CONFLICT DO NOTHING — never sets description, never deletes', async () => {
    const db = fakeDb();
    await syncActions(db, ['invoice.view', 'invoice.void', 'invoice.view']);

    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/INSERT INTO authz_action \(name\)/i);
    expect(text).toMatch(/ON CONFLICT \(name\) DO NOTHING/i);
    expect(text).not.toMatch(/description/i);
    expect(text).not.toMatch(/DELETE/i);
    // de-duped to the two distinct keys
    expect([...params].sort()).toEqual(['invoice.view', 'invoice.void']);
  });
});
