import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TenantContextNotEstablishedError, withTenantContext } from './with-tenant-context';
import type { SqlExecutor, TransactionalDb } from './sql-executor';

const dialect = new PgDialect();

function rendered(query: SQL) {
  return dialect.sqlToQuery(query);
}

/** A fake transactional db whose `tx.execute` answers `set_config` with the value it was given, and `current_setting` with whatever `settingValue` currently holds — a realistic-enough Postgres session model for these tests. */
function fakeTransactionalDb(opts: { confirmMismatch?: boolean } = {}): TransactionalDb & { calls: SQL[] } {
  const calls: SQL[] = [];
  let settingValue: string | null = null;

  const tx: SqlExecutor = {
    execute: vi.fn(async (query: SQL) => {
      calls.push(query);
      const { sql: text, params } = rendered(query);
      if (text.includes('set_config')) {
        settingValue = String(params[1]); // set_config(name, value, true) — value is the 2nd bound param
        return { rows: [{ set_config: settingValue }] };
      }
      if (text.includes('current_setting')) {
        return { rows: [{ value: opts.confirmMismatch ? 'something-else' : settingValue }] };
      }
      return { rows: [] };
    }),
  };

  return {
    calls,
    transaction: async (fn) => fn(tx),
  };
}

describe('withTenantContext', () => {
  it('sets app.current_tenant_id via set_config (not SET LOCAL — see the doc comment on bind parameters), is_local as a literal true', async () => {
    const db = fakeTransactionalDb();
    await withTenantContext(db, { kind: 'tenant', tenantId: 't-1' }, async () => 'ok');

    const setCall = rendered(db.calls[0]);
    expect(setCall.sql).toMatch(/select set_config\(\$1, \$2, true\)/i);
    expect(setCall.params).toEqual(['app.current_tenant_id', 't-1']);
  });

  it('sets app.current_payer_id for a payer scope', async () => {
    const db = fakeTransactionalDb();
    await withTenantContext(db, { kind: 'payer', payerId: 'p-1' }, async () => 'ok');

    expect(rendered(db.calls[0]).params).toEqual(['app.current_payer_id', 'p-1']);
  });

  it("sets app.is_admin = 'true' for an admin scope", async () => {
    const db = fakeTransactionalDb();
    await withTenantContext(db, { kind: 'admin' }, async () => 'ok');

    expect(rendered(db.calls[0]).params).toEqual(['app.is_admin', 'true']);
  });

  it('confirms the setting actually took effect via a current_setting read-back', async () => {
    const db = fakeTransactionalDb();
    await withTenantContext(db, { kind: 'tenant', tenantId: 't-1' }, async () => 'ok');

    expect(rendered(db.calls[1]).sql).toMatch(/current_setting\(\$1, true\)/i);
  });

  it('runs fn with the transactional handle once the setting is confirmed', async () => {
    const db = fakeTransactionalDb();
    const fn = vi.fn().mockResolvedValue('the-result');

    await expect(withTenantContext(db, { kind: 'tenant', tenantId: 't-1' }, fn)).resolves.toBe('the-result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws TenantContextNotEstablishedError when the confirmation read does not match — the pooler-misconfiguration case', async () => {
    const db = fakeTransactionalDb({ confirmMismatch: true });
    const fn = vi.fn();

    await expect(withTenantContext(db, { kind: 'tenant', tenantId: 't-1' }, fn)).rejects.toThrow(
      TenantContextNotEstablishedError,
    );
    expect(fn).not.toHaveBeenCalled(); // never runs the caller's query against an unconfirmed context
  });
});
