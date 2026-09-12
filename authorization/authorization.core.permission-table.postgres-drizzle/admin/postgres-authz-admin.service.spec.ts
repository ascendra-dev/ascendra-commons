import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { ActionNotFoundError, RoleNotFoundError } from '../../authorization.core.permission-table';
import { PostgresAuthzAdminService } from './postgres-authz-admin.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(route: (text: string) => unknown[] = () => []) {
  const execute = vi.fn(async (q: SQL) => ({ rows: route(dialect.sqlToQuery(q).sql) }));
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

function rendered(db: ReturnType<typeof fakeDb>, matcher: RegExp) {
  const call = db.execute.mock.calls.find(([q]) => matcher.test(dialect.sqlToQuery(q as SQL).sql));
  return call ? dialect.sqlToQuery(call[0] as SQL) : undefined;
}

const svc = (db: SqlExecutor) => new PostgresAuthzAdminService(db);

describe('PostgresAuthzAdminService.assignRole', () => {
  it('checks the role exists, then inserts idempotently', async () => {
    const db = fakeDb((text) => (/from commons_authz_role\b/i.test(text) ? [{ id: 'issuer' }] : []));
    await svc(db).assignRole({ userId: 'u1', tenantId: 't1', roleId: 'issuer', grantedBy: 'admin-1' });

    const insert = rendered(db, /insert into commons_authz_user_role/i)!;
    expect(insert.sql).toMatch(/on conflict on constraint commons_authz_user_role_uq do nothing/i);
    expect(insert.params).toEqual(expect.arrayContaining(['u1', 't1', 'issuer', 'admin-1']));
  });

  it('throws RoleNotFoundError when the role is not in the catalog — and issues no insert', async () => {
    const db = fakeDb(() => []);
    await expect(
      svc(db).assignRole({ userId: 'u1', tenantId: 't1', roleId: 'ghost', grantedBy: 'a' }),
    ).rejects.toBeInstanceOf(RoleNotFoundError);
    expect(db.execute.mock.calls.some(([q]) => /insert into/i.test(dialect.sqlToQuery(q as SQL).sql))).toBe(false);
  });
});

describe('PostgresAuthzAdminService.revokeRole', () => {
  it('deletes with tenant_id IS NULL for a platform assignment', async () => {
    const db = fakeDb();
    await svc(db).revokeRole({ userId: 'u1', tenantId: null, roleId: 'admin' });
    const del = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(del.sql).toMatch(/delete from commons_authz_user_role/i);
    expect(del.sql).toMatch(/tenant_id is null/i);
    expect(del.params).toEqual(expect.arrayContaining(['u1', 'admin']));
  });

  it('deletes with tenant_id = $ for a tenant assignment', async () => {
    const db = fakeDb();
    await svc(db).revokeRole({ userId: 'u1', tenantId: 't9', roleId: 'issuer' });
    const del = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(del.sql).toMatch(/tenant_id =/i);
    expect(del.params).toContain('t9');
  });
});

describe('PostgresAuthzAdminService.setActionDescription', () => {
  it('updates and returns; a hit resolves', async () => {
    const db = fakeDb(() => [{ name: 'invoice.view' }]);
    await expect(svc(db).setActionDescription('invoice.view', 'View invoices')).resolves.toBeUndefined();
    const upd = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(upd.sql).toMatch(/update commons_authz_action set description/i);
    expect(upd.params).toEqual(expect.arrayContaining(['View invoices', 'invoice.view']));
  });

  it('throws ActionNotFoundError when no row matched', async () => {
    const db = fakeDb(() => []);
    await expect(svc(db).setActionDescription('ghost.action', 'x')).rejects.toBeInstanceOf(ActionNotFoundError);
  });
});
