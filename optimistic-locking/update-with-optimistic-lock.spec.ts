import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { updateWithOptimisticLock } from './update-with-optimistic-lock';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>) {
  return dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
}

describe('updateWithOptimisticLock', () => {
  it('returns { ok: true } when exactly one row matched', async () => {
    const db = fakeDb([{ id: 'inv-1' }]);
    await expect(updateWithOptimisticLock(db, 'invoice', 'inv-1', 3, { status: 'paid' })).resolves.toEqual({
      ok: true,
    });
  });

  it('returns { ok: false, reason: "stale_version" } when nothing matched — never throws', async () => {
    const db = fakeDb([]);
    await expect(updateWithOptimisticLock(db, 'invoice', 'inv-1', 3, { status: 'paid' })).resolves.toEqual({
      ok: false,
      reason: 'stale_version',
    });
  });

  it('issues one atomic UPDATE guarded on id + version, incrementing version', async () => {
    const db = fakeDb([{ id: 'inv-1' }]);
    await updateWithOptimisticLock(db, 'invoice', 'inv-1', 3, { status: 'paid' });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/update "invoice"/i);
    expect(text).toMatch(/set .*"status" = \$\d+.*version = version \+ 1/is);
    expect(text).toMatch(/where id = \$\d+ and version = \$\d+/i);
    expect(text).toMatch(/returning id/i);
    expect(params).toEqual(expect.arrayContaining(['paid', 'inv-1', 3]));
  });

  it('rejects a column name that is not a plain SQL identifier, before ever building the query', async () => {
    const db = fakeDb();
    // drizzle-orm's own sql.identifier() quotes but does not escape an embedded
    // `"` (PgDialect.escapeName is literally `"${name}"`) — this helper doesn't
    // trust that alone; a non-plain identifier is rejected outright instead.
    const maliciousColumn = 'status"; drop table invoice; --';
    await expect(updateWithOptimisticLock(db, 'invoice', 'inv-1', 1, { [maliciousColumn]: 'x' })).rejects.toThrow(
      /not a valid SQL identifier/,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('rejects a table name that is not a plain SQL identifier', async () => {
    const db = fakeDb();
    await expect(updateWithOptimisticLock(db, 'invoice; drop table invoice; --', 'inv-1', 1, {})).rejects.toThrow(
      /not a valid SQL identifier/,
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('binds every changed column as a parameter, not interpolated into the SQL text', async () => {
    const db = fakeDb([{ id: 'inv-1' }]);
    await updateWithOptimisticLock(db, 'invoice', 'inv-1', 1, { amount: 4820, currency: 'USD' });

    const { params } = rendered(db);
    expect(params).toEqual(expect.arrayContaining([4820, 'USD']));
  });

  it('throws immediately if changes includes "version" — a caller bug, not a silent overwrite', async () => {
    const db = fakeDb();
    await expect(updateWithOptimisticLock(db, 'invoice', 'inv-1', 1, { version: 99 })).rejects.toThrow(/version/);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('throws immediately if changes includes "id"', async () => {
    const db = fakeDb();
    await expect(updateWithOptimisticLock(db, 'invoice', 'inv-1', 1, { id: 'other' })).rejects.toThrow(/"id"/);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('supports an empty changes object — a pure version bump with no field changes', async () => {
    const db = fakeDb([{ id: 'inv-1' }]);
    await expect(updateWithOptimisticLock(db, 'invoice', 'inv-1', 1, {})).resolves.toEqual({ ok: true });

    const { sql: text } = rendered(db);
    expect(text).toMatch(/set version = version \+ 1/i);
  });
});
