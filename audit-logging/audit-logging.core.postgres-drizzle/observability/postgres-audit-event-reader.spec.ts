import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAuditEventReader } from './postgres-audit-event-reader';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

let seq = 0;
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `id-${seq}`,
    entity_type: 'invoice',
    entity_id: 'inv-1',
    tenant_id: 'tenant-1',
    actor: 'user-1',
    action: 'status_changed',
    before: { status: 'sent' },
    after: { status: 'paid' },
    correlation_id: 'trace-1',
    reason: null,
    occurred_at: new Date('2026-06-01T10:00:00Z'),
    ...over,
  };
}

function reader(db: SqlExecutor) {
  return new PostgresAuditEventReader(db, 'ascendra-pay');
}

describe('PostgresAuditEventReader.find', () => {
  it('always scopes to the application and maps rows to AuditEvent', async () => {
    const db = fakeDb([row({ entity_id: 'a' }), row({ entity_id: 'b', tenant_id: null, before: null })]);
    const result = await reader(db).find({});

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(result.records[0]).toMatchObject({
      entityId: 'a',
      entityType: 'invoice',
      tenantId: 'tenant-1',
      before: { status: 'sent' },
      correlationId: 'trace-1',
    });
    expect(result.records[1]).toMatchObject({ tenantId: null, before: null });
    expect(result.nextCursor).toBeUndefined();
  });

  it('ANDs the optional filters as bound params', async () => {
    const db = fakeDb([]);
    await reader(db).find({
      entityType: 'invoice',
      entityId: 'inv-9',
      actor: 'user-7',
      action: 'deleted',
      correlationId: 'trace-xyz',
      occurredAfter: new Date('2026-01-01T00:00:00Z'),
      occurredBefore: new Date('2026-07-01T00:00:00Z'),
    });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/entity_type =/i);
    expect(text).toMatch(/entity_id =/i);
    expect(text).toMatch(/actor =/i);
    expect(text).toMatch(/action =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(text).toMatch(/occurred_at >=/i);
    expect(text).toMatch(/occurred_at </i);
    expect(params).toEqual(expect.arrayContaining(['invoice', 'inv-9', 'user-7', 'deleted', 'trace-xyz']));
  });

  it('distinguishes an absent tenantId (no filter) from an explicit null (IS NULL)', async () => {
    const none = fakeDb([]);
    await reader(none).find({});
    expect(rendered(none).sql).not.toMatch(/tenant_id (=|is null)/i); // no tenant filter in WHERE (column still in SELECT list)

    const platform = fakeDb([]);
    await reader(platform).find({ tenantId: null });
    expect(rendered(platform).sql).toMatch(/tenant_id is null/i);

    const one = fakeDb([]);
    await reader(one).find({ tenantId: 't-3' });
    expect(rendered(one).sql).toMatch(/tenant_id =/i);
    expect(rendered(one).params).toContain('t-3');
  });

  it('returns a nextCursor when more rows exist and keys the next page off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: `id-${100 + i}` }));
    const db = fakeDb(many);
    const page = await reader(db).find({ limit: 50 });

    expect(page.records).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();

    const db2 = fakeDb([]);
    await reader(db2).find({ cursor: page.nextCursor, limit: 50 });
    expect(rendered(db2).sql).toMatch(/occurred_at < .* or .*occurred_at = .* and id </is);
  });

  it('caps limit at 200 and ignores a malformed cursor', async () => {
    const db = fakeDb([]);
    await reader(db).find({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);

    const db2 = fakeDb([]);
    await expect(reader(db2).find({ cursor: 'garbage' })).resolves.toEqual({ records: [] });
  });
});
