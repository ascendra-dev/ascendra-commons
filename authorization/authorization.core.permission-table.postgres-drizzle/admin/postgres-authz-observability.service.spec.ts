import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAuthzObservabilityService } from './postgres-authz-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

type Responses = {
  /** rows for listRoles() */
  roles?: unknown[];
  /** rows for getRole(id) */
  role?: unknown[];
  /** rows for countHolders(roleId) */
  holderCount?: unknown[];
  /** rows for listUserRoleAssignments() */
  userRoles?: unknown[];
  /** rows for explainAccess()'s "roles this user holds" query */
  heldRoles?: unknown[];
  delegations?: unknown[];
  actions?: unknown[];
  granted?: unknown[];
  /** rows for whoCan()'s "roles that grant this action" query */
  whoCanRoles?: unknown[];
  /** rows for whoCan()'s "holders of those roles" query */
  whoCanHolders?: unknown[];
  /** rows for whoCan()'s "active delegations granting this action" query */
  whoCanDelegations?: unknown[];
};

function fakeDb(responses: Responses = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (/count\(distinct user_id\)/i.test(text)) return { rows: responses.holderCount ?? [] };
    if (/r\.grants_all = true or rp\.action/i.test(text)) return { rows: responses.whoCanRoles ?? [] };
    if (/role_id = any/i.test(text)) return { rows: responses.whoCanHolders ?? [] };
    if (/actions @>/i.test(text)) return { rows: responses.whoCanDelegations ?? [] };
    if (/where r\.id =/i.test(text)) return { rows: responses.role ?? [] };
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
      const gaDb = fakeDb({ heldRoles: [{ role_id: 'admin', tenant_id: null, grants_all: true, actions: [] }] });
      const ga = await svc(gaDb).explainAccess('u1', 't1', 'invoice.void');
      expect(ga.effectiveActions).toBe('*');
      expect(ga).toMatchObject({ allowed: true, reason: expect.stringContaining("role 'admin'") });

      const db = fakeDb({
        heldRoles: [{ role_id: 'issuer', tenant_id: 't1', grants_all: false, actions: ['invoice.view'] }],
        delegations: [{ id: 'd1', granter_id: 'boss', actions: ['invoice.void'], expires_at: new Date('2027-01-01T00:00:00Z') }],
      });
      const e = await svc(db).explainAccess('u1', 't1');
      expect(e.effectiveActions).toEqual(['invoice.view', 'invoice.void']);
      expect(e.roles).toHaveLength(1);
      expect(e.delegations).toHaveLength(1);
      expect(e.allowed).toBeUndefined(); // no action asked
    });

    it('reports the scope (tenant-scoped vs. platform-wide) each held role was granted at', async () => {
      const db = fakeDb({
        heldRoles: [
          { role_id: 'reviewer', tenant_id: 't1', grants_all: false, actions: ['kyc.review'] },
          { role_id: 'ascendra_admin', tenant_id: null, grants_all: true, actions: [] },
        ],
      });
      const e = await svc(db).explainAccess('u1', 't1');
      expect(e.roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ roleId: 'reviewer', tenantId: 't1' }),
          expect.objectContaining({ roleId: 'ascendra_admin', tenantId: null }),
        ]),
      );
    });

    it('explains an allow via role, an allow via delegation, and a denial', async () => {
      const db = fakeDb({
        heldRoles: [{ role_id: 'issuer', tenant_id: 't1', grants_all: false, actions: ['invoice.view'] }],
        delegations: [{ id: 'd1', granter_id: 'boss', actions: ['invoice.void'], expires_at: new Date('2027-01-01T00:00:00Z') }],
      });
      expect((await svc(db).explainAccess('u1', 't1', 'invoice.view')).reason).toMatch(/role 'issuer'/);
      expect((await svc(db).explainAccess('u1', 't1', 'invoice.void')).reason).toMatch(/delegation d1 from boss/);
      const denied = await svc(db).explainAccess('u1', 't1', 'invoice.delete');
      expect(denied).toMatchObject({ allowed: false, reason: expect.stringContaining("no role or active delegation") });
    });

    it('skips the delegation query entirely for a null tenant', async () => {
      const db = fakeDb({ heldRoles: [{ role_id: 'admin', tenant_id: null, grants_all: false, actions: ['x'] }] });
      await svc(db).explainAccess('u1', null);
      expect(db.execute.mock.calls.some(([q]) => /commons_authz_delegation/i.test(dialect.sqlToQuery(q as SQL).sql))).toBe(false);
    });
  });

  describe('getRole / countHolders', () => {
    it('getRole maps the row when found, null otherwise', async () => {
      const db = fakeDb({
        role: [{ id: 'issuer', description: 'Issuer', grants_all: false, actions: ['invoice.view'] }],
      });
      await expect(svc(db).getRole('issuer')).resolves.toEqual({
        id: 'issuer',
        description: 'Issuer',
        grantsAll: false,
        actions: ['invoice.view'],
      });

      const missing = fakeDb({ role: [] });
      await expect(svc(missing).getRole('ghost')).resolves.toBeNull();
    });

    it('countHolders parses the count column', async () => {
      const db = fakeDb({ holderCount: [{ count: '4' }] });
      await expect(svc(db).countHolders('issuer')).resolves.toBe(4);

      const zero = fakeDb({ holderCount: [] });
      await expect(svc(zero).countHolders('ghost')).resolves.toBe(0);
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

  it('listDelegations renders the expiringWithinDays predicate', async () => {
    const db = fakeDb();
    await svc(db).listDelegations({ expiringWithinDays: 7, tenantId: 't1' });
    const { sql: text, params } = dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/revoked_at is null and expires_at > now\(\) and expires_at <= now\(\) \+ \(.* \* interval '1 day'\)/i);
    expect(params).toEqual(expect.arrayContaining(['t1', 7]));
  });

  describe('whoCan', () => {
    it('reports roles that grant the action (directly or via grantsAll), their holders, and active delegations', async () => {
      const db = fakeDb({
        whoCanRoles: [
          { id: 'ascendra_admin', grants_all: true },
          { id: 'finance_approver', grants_all: false },
        ],
        whoCanHolders: [
          { role_id: 'ascendra_admin', user_id: 'u_1c07' },
          { role_id: 'finance_approver', user_id: 'u_9f3a' },
          { role_id: 'finance_approver', user_id: 'u_2210' },
        ],
        whoCanDelegations: [
          { id: 'd1', granter_id: 'u_9f3a', grantee_id: 'u_44b2', expires_at: new Date('2027-01-01T00:00:00Z') },
        ],
      });

      const result = await svc(db).whoCan('payout.approve', 't_kairos');

      expect(result.action).toBe('payout.approve');
      expect(result.tenantId).toBe('t_kairos');
      expect(result.roles).toEqual(
        expect.arrayContaining([
          { roleId: 'ascendra_admin', grantsAll: true, holderUserIds: ['u_1c07'] },
          { roleId: 'finance_approver', grantsAll: false, holderUserIds: ['u_2210', 'u_9f3a'] },
        ]),
      );
      expect(result.delegations).toEqual([
        { id: 'd1', granterId: 'u_9f3a', granteeId: 'u_44b2', expiresAt: new Date('2027-01-01T00:00:00Z') },
      ]);
    });

    it('reports tenantId null and skips the holders/delegation tenant filter when no tenant is given', async () => {
      const db = fakeDb({ whoCanRoles: [{ id: 'ascendra_admin', grants_all: true }], whoCanHolders: [] });
      const result = await svc(db).whoCan('payout.approve');
      expect(result.tenantId).toBeNull();

      const holdersCall = db.execute.mock.calls.find(([q]) => /role_id = any/i.test(dialect.sqlToQuery(q as SQL).sql));
      expect(dialect.sqlToQuery(holdersCall![0] as SQL).sql).not.toMatch(/tenant_id/i);
    });

    it('returns empty results when no role or delegation grants the action', async () => {
      const db = fakeDb({ whoCanRoles: [], whoCanDelegations: [] });
      const result = await svc(db).whoCan('nothing.grants.this', 't1');
      expect(result).toMatchObject({ roles: [], delegations: [] });
    });
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
