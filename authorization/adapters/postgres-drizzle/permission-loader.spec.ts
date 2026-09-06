import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Actor } from '../../authorization.types';
import { PermissionLoader } from './permission-loader';
import { runWithPermissionCache } from './permission-cache';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();
const ACTOR: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };

/** Routes each query to a response based on which table it hits. */
function fakeDb(responses: { roles?: unknown[]; delegations?: unknown[] } = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes('commons_authz_user_role')) return { rows: responses.roles ?? [] };
    if (text.includes('commons_authz_delegation')) return { rows: responses.delegations ?? [] };
    return { rows: [] };
  });
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe('PermissionLoader', () => {
  it('rolePermissions collects granted actions and the grants_all flag', async () => {
    const db = fakeDb({
      roles: [
        { action: 'invoice.view', grants_all: false },
        { action: 'invoice.void', grants_all: false },
      ],
    });
    const perms = await new PermissionLoader(db).rolePermissions(ACTOR);

    expect(perms.grantsAll).toBe(false);
    expect([...perms.actions].sort()).toEqual(['invoice.view', 'invoice.void']);
  });

  it('rolePermissions reports grantsAll and ignores the null action row of a wildcard role', async () => {
    const db = fakeDb({ roles: [{ action: null, grants_all: true }] });
    const perms = await new PermissionLoader(db).rolePermissions(ACTOR);

    expect(perms.grantsAll).toBe(true);
    expect(perms.actions.size).toBe(0);
  });

  it('effectivePermissions unions role actions with active delegated actions', async () => {
    const db = fakeDb({
      roles: [{ action: 'invoice.view', grants_all: false }],
      delegations: [{ action: 'payment.refund' }],
    });
    const perms = await new PermissionLoader(db).effectivePermissions(ACTOR);

    expect([...perms.actions].sort()).toEqual(['invoice.view', 'payment.refund']);
  });

  it('never queries delegations for a null-tenant actor', async () => {
    const db = fakeDb({ roles: [{ action: 'platform.admin', grants_all: false }] });
    await new PermissionLoader(db).effectivePermissions({ id: 'admin', persona: 'admin', tenantId: null });

    const tables = db.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL).sql);
    expect(tables.some((t) => t.includes('commons_authz_delegation'))).toBe(false);
  });

  it('within a permission-cache scope, repeated lookups for the same actor query once', async () => {
    const db = fakeDb({ roles: [{ action: 'invoice.view', grants_all: false }] });
    const loader = new PermissionLoader(db);

    await runWithPermissionCache(async () => {
      await loader.rolePermissions(ACTOR);
      await loader.rolePermissions(ACTOR);
      await loader.effectivePermissions(ACTOR);
    });

    const roleQueries = db.execute.mock.calls.filter((c) => dialect.sqlToQuery(c[0] as SQL).sql.includes('commons_authz_user_role'));
    expect(roleQueries).toHaveLength(1);
  });

  it('without a cache scope, each lookup queries again', async () => {
    const db = fakeDb({ roles: [] });
    const loader = new PermissionLoader(db);

    await loader.rolePermissions(ACTOR);
    await loader.rolePermissions(ACTOR);

    const roleQueries = db.execute.mock.calls.filter((c) => dialect.sqlToQuery(c[0] as SQL).sql.includes('commons_authz_user_role'));
    expect(roleQueries).toHaveLength(2);
  });
});
