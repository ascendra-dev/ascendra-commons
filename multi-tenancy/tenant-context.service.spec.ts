import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TenantContext } from './tenant-context.service';
import { DefaultTenantScopeResolver } from './tenant-scope-resolver';
import type { SqlExecutor, TransactionalDb } from './sql-executor';
import type { Actor } from '../authorization/authorization.core';

const dialect = new PgDialect();

/** A fake transactional db that answers set_config/current_setting consistently, so withTenantContext's own confirmation check always passes — this file tests TenantContext's delegation, not withTenantContext's own SQL (see with-tenant-context.spec.ts for that). */
function fakeConfirmingDb(): TransactionalDb {
  let value: string | null = null;
  const tx: SqlExecutor = {
    execute: vi.fn(async (query: SQL) => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      if (text.includes('set_config')) {
        value = String(params[1]);
        return { rows: [] };
      }
      return { rows: [{ value }] };
    }),
  };
  return { transaction: (fn) => fn(tx) };
}

describe('TenantContext', () => {
  it("resolves the scope from the request's actor via the injected resolver, then runs fn through it", async () => {
    const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't-1' };
    const resolver = { resolve: vi.fn().mockReturnValue({ kind: 'tenant' as const, tenantId: 't-1' }) };
    const tenantContext = new TenantContext({ actor }, resolver);
    const db = fakeConfirmingDb();
    const fn = vi.fn().mockResolvedValue('result');

    await expect(tenantContext.run(db, fn)).resolves.toBe('result');

    expect(resolver.resolve).toHaveBeenCalledWith(actor);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('DefaultTenantScopeResolver', () => {
  it('scopes an actor with a tenantId to that tenant', () => {
    const actor: Actor = { id: 'u1', persona: 'issuer', tenantId: 't-1' };
    expect(new DefaultTenantScopeResolver().resolve(actor)).toEqual({ kind: 'tenant', tenantId: 't-1' });
  });

  it('treats an actor with no tenantId as admin', () => {
    const actor: Actor = { id: 'u1', persona: 'ascendra_admin', tenantId: null };
    expect(new DefaultTenantScopeResolver().resolve(actor)).toEqual({ kind: 'admin' });
  });
});
