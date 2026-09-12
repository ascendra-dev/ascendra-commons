import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAuthzObservabilityService } from './postgres-authz-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

type Responses = {
  /** rows for listRoles() */
  roles?: unknown[];
  /** rows for listUserRoleAssignments() */
  userRoles?: unknown[];
  /** rows for explainAccess()'s "roles this user holds" query */
  heldRoles?: unknown[];
  delegations?: unknown[];
  actions?: unknown[];
  granted?: unknown[];
};

function fakeDb(responses: Responses = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (/group by r\.id, r\.description/i.test(text)) return { rows: responses.roles ?? [] };
    if (/from commons_authz_user_role ur/i.test(text)) return { rows: responses.heldRoles ?? [] };
    if (/from commons_authz_user_role\b/i.test(text)) return { rows: responses.userRoles ?? [] };
    if (/from commons_authz_delegation/i.test(text)) return { rows: responses.delegations ?? [] };
    if (/distinct action\s+from commons_authz_role_permission/i.test(text)) return { rows: responses.granted ?? [] };
    if (/from commons_authz_action/i.test(text)) return { rows: responses.actions ?? [] };
    return { rows: [] };
  });
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

const svc = (db: SqlExecutor) => new PostgresAuthzObservabilityService(db);

function paramsOf(db: ReturnType<typeof fakeDb>, matcher: RegExp) {
  const call = db.execute.mock.calls.find(([q]) => matcher.test(dialect.sqlToQuery(q as SQL).sql));
  return call ? dialect.sqlToQuery(call[0] as SQL).params : undefined;
}

describe('PostgresAuthzObservabilityService', () => {
  it('listRoles maps rows; a grants_all role reports empty actions', async () => {
    const db = fakeDb({
      roles: [
        { id: 'issuer', description: 'Issuer', grants_all: false, actions: ['invoice.view', 'invoice.void'] },
        { id: 'admin', description: null, grants_all: true, actions: [] },
      ],
    });
    const roles = await svc(db).listRoles();

    expect(roles[0]).toEqual({ id: 'issuer', description: 'Issuer', grantsAll: false, actions: ['invoice.view', 'invoice.void'] });
    expect(roles[1]).toEqual({ id: 'admin', description: null, grantsAll: true, actions: [] });
  });

  it('listUserRoleAssignments distinguishes an absent tenantId from an explicit null', async () => {
    const none = fakeDb();
    await svc(none).listUserRoleAssignments({ userId: 'u1' });
    expect(dialect.sqlToQuery(none.execute.mock.calls[0][0] as SQL).sql).not.toMatch(/tenant_id (is null|=)/i);

    const platform = fakeDb();
    await svc(platform).listUserRoleAssignments({ tenantId: null });
    expect(dialect.sqlToQuery(platform.execute.mock.calls[0][0] as SQL).sql).toMatch(/tenant_id is null/i);

    const one = fakeDb();
    await svc(one).listUserRoleAssignments({ tenantId: 't7', roleId: 'issuer' });
    const { sql: text, params } = dialect.sqlToQuery(one.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/tenant_id =/i);
    expect(params).toEqual(expect.arrayContaining(['t7', 'issuer']));
  });

  describe('explainAccess', () => {
    it('unions role and delegation actions; grants_all → "*"', async () => {
      const gaDb = fakeDb({ heldRoles: [{ role_id: 'admin', grants_all: true, actions: [] }] });
      const ga = await svc(gaDb).explainAccess('u1', 't1', 'invoice.void');
      expect(ga.effectiveActions).toBe('*');
      expect(ga).toMatchObject({ allowed: true, reason: expect.stringContaining("role 'admin'") });

      const db = fakeDb({
        heldRoles: [{ role_id: 'issuer', grants_all: false, actions: ['invoice.view'] }],
        delegations: [{ id: 'd1', granter_id: 'boss', actions: ['invoice.void'], expires_at: new Date('2027-01-01T00:00:00Z') }],
      });
      const e = await svc(db).explainAccess('u1', 't1');
      expect(e.effectiveActions).toEqual(['invoice.view', 'invoice.void']);
      expect(e.roles).toHaveLength(1);
      expect(e.delegations).toHaveLength(1);
      expect(e.allowed).toBeUndefined(); // no action asked
    });

    it('explains an allow via role, an allow via delegation, and a denial', async () => {
      const db = fakeDb({
        heldRoles: [{ role_id: 'issuer', grants_all: false, actions: ['invoice.view'] }],
        delegations: [{ id: 'd1', granter_id: 'boss', actions: ['invoice.void'], expires_at: new Date('2027-01-01T00:00:00Z') }],
      });
      expect((await svc(db).explainAccess('u1', 't1', 'invoice.view')).reason).toMatch(/role 'issuer'/);
      expect((await svc(db).explainAccess('u1', 't1', 'invoice.void')).reason).toMatch(/delegation d1 from boss/);
      const denied = await svc(db).explainAccess('u1', 't1', 'invoice.delete');
      expect(denied).toMatchObject({ allowed: false, reason: expect.stringContaining("no role or active delegation") });
    });

    it('skips the delegation query entirely for a null tenant', async () => {
      const db = fakeDb({ heldRoles: [{ role_id: 'admin', grants_all: false, actions: ['x'] }] });
      await svc(db).explainAccess('u1', null);
      expect(db.execute.mock.calls.some(([q]) => /commons_authz_delegation/i.test(dialect.sqlToQuery(q as SQL).sql))).toBe(false);
    });
  });

  it('listDelegations renders status filters and paginates', async () => {
    const active = fakeDb();
    await svc(active).listDelegations({ status: 'active', granteeId: 'u1' });
    expect(dialect.sqlToQuery(active.execute.mock.calls[0][0] as SQL).sql).toMatch(/revoked_at is null and expires_at > now\(\)/i);
    expect(paramsOf(active, /commons_authz_delegation/)).toContain('u1');

    const many = Array.from({ length: 51 }, (_, i) => ({
      id: `d-${i}`, granter_id: 'g', grantee_id: 'u1', tenant_id: 't1', actions: ['a'],
      expires_at: new Date('2027-01-01T00:00:00Z'), revoked_at: null, revoked_by: null,
      reason: null, created_at: new Date('2026-06-01T00:00:00Z'), created_by: 'g',
    }));
    const db = fakeDb({ delegations: many });
    const page = await svc(db).listDelegations({ limit: 50 });
    expect(page.delegations).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();
  });

  it('actionCatalogHealth reports code/db drift and undescribed granted actions', async () => {
    const db = fakeDb({
      actions: [
        { name: 'invoice.view', description: 'View invoices' },
        { name: 'invoice.void', description: '' },
        { name: 'legacy.thing', description: null },
      ],
      granted: [{ action: 'invoice.view' }, { action: 'invoice.void' }],
    });
    const health = await svc(db).actionCatalogHealth(['invoice.view', 'invoice.void', 'invoice.delete']);

    expect(health.inCodeNotInDb).toEqual(['invoice.delete']);
    expect(health.inDbNotInCode).toEqual(['legacy.thing']);
    expect(health.grantedButUndescribed).toEqual(['invoice.void']);
    expect(health).toMatchObject({ describedCount: 1, totalCount: 3 });
  });
});
