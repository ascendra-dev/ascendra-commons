import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresPermissionRepository } from './postgres-permission.repository';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(responses: { roles?: unknown[]; delegations?: unknown[] } = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes('commons_authz_delegation')) return { rows: responses.delegations ?? [] };
    if (text.includes('commons_authz_user_role')) return { rows: responses.roles ?? [] };
    return { rows: [] };
  });
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

describe('PostgresPermissionRepository', () => {
  it('loadRolePermissions collects granted actions and the grants_all flag', async () => {
    const db = fakeDb({
      roles: [
        { action: 'invoice.view', grants_all: false },
        { action: 'invoice.void', grants_all: false },
      ],
    });
    const set = await new PostgresPermissionRepository(db).loadRolePermissions('u1', 't1');

    expect(set.grantsAll).toBe(false);
    expect([...set.actions].sort()).toEqual(['invoice.view', 'invoice.void']);
    const { params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining(['u1', 't1']));
  });

  it('loadRolePermissions ignores an expired assignment', async () => {
    const db = fakeDb();
    await new PostgresPermissionRepository(db).loadRolePermissions('u1', 't1');
    const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
    expect(text).toMatch(/ur\.expires_at is null or ur\.expires_at > now\(\)/i);
  });

  it('loadRolePermissions reports grantsAll and drops the null action row of a wildcard role', async () => {
    const db = fakeDb({ roles: [{ action: null, grants_all: true }] });
    const set = await new PostgresPermissionRepository(db).loadRolePermissions('u1', 't1');

    expect(set.grantsAll).toBe(true);
    expect(set.actions).toEqual([]);
  });

  it('loadActiveDelegatedActions filters revoked/expired in SQL and returns the action names', async () => {
    const db = fakeDb({ delegations: [{ action: 'payment.refund' }] });
    const actions = await new PostgresPermissionRepository(db).loadActiveDelegatedActions('u1', 't1');

    expect(actions).toEqual(['payment.refund']);
    const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
    expect(text).toMatch(/revoked_at IS NULL/i);
    expect(text).toMatch(/expires_at > now\(\)/i);
  });

  it('loadActiveDelegatedActions lends only what the granter still holds from an active role', async () => {
    const db = fakeDb();
    await new PostgresPermissionRepository(db).loadActiveDelegatedActions('u1', 't1');
    const text = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL).sql;
    expect(text).toMatch(/gur\.user_id = d\.granter_id/i);
    expect(text).toMatch(/gur\.tenant_id = d\.tenant_id or gur\.tenant_id is null/i);
    expect(text).toMatch(/gur\.expires_at is null or gur\.expires_at > now\(\)/i);
    expect(text).toMatch(/grp\.action = da\.action/i);
  });
});
