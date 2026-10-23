import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { InvalidAuthzCursorError } from '../../authorization.core.permission-table';
import { PostgresAuthzObservabilityService } from './postgres-authz-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

type Responses = {
  /** rows for listRoles() / getRole() */
  roles?: unknown[];
  /** rows for countHolders(roleId) */
  holderCount?: unknown[];
  /** rows for listUserRoleAssignments() */
  userRoles?: unknown[];
  /** rows for explainAccess()'s "roles this user holds" query */
  heldRoles?: unknown[];
  delegations?: unknown[];
  actions?: unknown[];
  granted?: unknown[];
  /** rows for listActions() */
  catalog?: unknown[];
  /** rows for whoCan()'s roles-with-holders query */
  whoCanRoles?: unknown[];
  /** rows for whoCan()'s "active delegations granting this action" query */
  whoCanDelegations?: unknown[];
  exactHolders?: unknown[];
};

function fakeDb(responses: Responses = {}) {
  const execute = vi.fn(async (q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    if (/count\(distinct ur\.user_id\)/i.test(text)) return { rows: responses.holderCount ?? [] };
    if (/as holders/i.test(text)) return { rows: responses.whoCanRoles ?? [] };
    if (/= any\(d\.actions\)/i.test(text)) return { rows: responses.whoCanDelegations ?? [] };
    if (/as role_ids/i.test(text)) return { rows: responses.catalog ?? [] };
    if (/as platform_actions/i.test(text)) return { rows: responses.roles ?? [] };
    if (/granted_at_key/i.test(text)) return { rows: responses.userRoles ?? [] };
    if (/select ur\.user_id, ur\.role_id\s+from/i.test(text)) return { rows: responses.exactHolders ?? [] };
    if (/from commons_authz_user_role ur/i.test(text)) return { rows: responses.heldRoles ?? [] };
    if (/from commons_authz_delegation d/i.test(text)) return { rows: responses.delegations ?? [] };
    if (/distinct action\s+from commons_authz_role_permission/i.test(text)) return { rows: responses.granted ?? [] };
    if (/from commons_authz_action/i.test(text)) return { rows: responses.actions ?? [] };
    return { rows: [] };
  });
  return { execute } as unknown as SqlExecutor & { execute: ReturnType<typeof vi.fn> };
}

const svc = (db: SqlExecutor) => new PostgresAuthzObservabilityService(db);
const textOf = (db: ReturnType<typeof fakeDb>, i = 0) => dialect.sqlToQuery(db.execute.mock.calls[i][0] as SQL);

describe('PostgresAuthzObservabilityService', () => {
  it('listRoles maps rows with their scope; a grants_all role reports empty actions and is platform', async () => {
    const db = fakeDb({
      roles: [
        { id: 'issuer', description: 'Issuer', grants_all: false, actions: ['invoice.view', 'invoice.void'], platform_actions: [] },
        { id: 'ops', description: null, grants_all: false, actions: ['job.run', 'invoice.view'], platform_actions: ['job.run'] },
        { id: 'admin', description: null, grants_all: true, actions: [], platform_actions: [] },
      ],
    });
    const roles = await svc(db).listRoles();

    expect(roles[0]).toEqual({
      id: 'issuer', description: 'Issuer', grantsAll: false, actions: ['invoice.view', 'invoice.void'], scope: 'tenant', platformActions: [],
    });
    expect(roles[1]).toMatchObject({ id: 'ops', scope: 'platform', platformActions: ['job.run'] });
    expect(roles[2]).toEqual({ id: 'admin', description: null, grantsAll: true, actions: [], scope: 'platform', platformActions: [] });
  });

  it('listActions maps each action with its scope and granting roles', async () => {
    const db = fakeDb({
      catalog: [
        { name: 'invoice.view', description: 'View', scope: 'tenant', role_ids: ['issuer'] },
        { name: 'job.run', description: null, scope: 'platform', role_ids: [] },
      ],
    });
    await expect(svc(db).listActions()).resolves.toEqual([
      { name: 'invoice.view', description: 'View', scope: 'tenant', roleIds: ['issuer'] },
      { name: 'job.run', description: null, scope: 'platform', roleIds: [] },
    ]);
  });

  describe('listUserRoleAssignments', () => {
    it('distinguishes an absent tenantId from an explicit null', async () => {
      const none = fakeDb();
      await svc(none).listUserRoleAssignments({ userId: 'u1' });
      expect(textOf(none).sql).not.toMatch(/ur\.tenant_id (is null|=)/i);

      const platform = fakeDb();
      await svc(platform).listUserRoleAssignments({ tenantId: null });
      expect(textOf(platform).sql).toMatch(/ur\.tenant_id is null/i);

      const one = fakeDb();
      await svc(one).listUserRoleAssignments({ tenantId: 't7', roleId: 'issuer' });
      const { sql: text, params } = textOf(one);
      expect(text).toMatch(/ur\.tenant_id =/i);
      expect(params).toEqual(expect.arrayContaining(['t7', 'issuer']));
    });

    it('reports an expired assignment as expired, and filters by status', async () => {
      const db = fakeDb({
        userRoles: [
          { user_id: 'u1', tenant_id: 't1', role_id: 'r', granted_at: new Date(), granted_by: 'a', expires_at: new Date(Date.now() - 1000), granted_at_key: 'x' },
          { user_id: 'u2', tenant_id: 't1', role_id: 'r', granted_at: new Date(), granted_by: 'a', expires_at: null, granted_at_key: 'x' },
        ],
      });
      const page = await svc(db).listUserRoleAssignments({ status: 'active' });
      expect(page.assignments.map((a) => a.status)).toEqual(['expired', 'active']);
      expect(textOf(db).sql).toMatch(/ur\.expires_at is null or ur\.expires_at > now\(\)/i);
    });

    it('pages with a JSON cursor at microsecond precision, and rejects one it never issued', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        user_id: `u${i}`, tenant_id: null, role_id: 'r', granted_at: new Date(), granted_by: null, expires_at: null,
        granted_at_key: '2026-10-23T07:39:30.257123Z',
      }));
      const db = fakeDb({ userRoles: rows });
      const page = await svc(db).listUserRoleAssignments({ limit: 2 });
      expect(page.assignments).toHaveLength(2);
      const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
      expect(cursor).toEqual({ ts: '2026-10-23T07:39:30.257123Z', userId: 'u1', roleId: 'r', tenantId: null });

      const next = fakeDb();
      await svc(next).listUserRoleAssignments({ cursor: page.nextCursor });
      expect(textOf(next).params).toEqual(expect.arrayContaining(['2026-10-23T07:39:30.257123Z', 'u1', 'r', '']));

      await expect(svc(fakeDb()).listUserRoleAssignments({ cursor: 'garbage' })).rejects.toBeInstanceOf(InvalidAuthzCursorError);
    });
  });

  describe('explainAccess', () => {
    it('unions role and delegation actions; grants_all → "*"; reads active assignments only', async () => {
      const gaDb = fakeDb({ heldRoles: [{ role_id: 'admin', tenant_id: null, grants_all: true, actions: [], expires_at: null }] });
      const ga = await svc(gaDb).explainAccess('u1', 't1', 'invoice.void');
      expect(ga.effectiveActions).toBe('*');
      expect(ga).toMatchObject({ allowed: true, reason: expect.stringContaining("role 'admin'") });
      expect(textOf(gaDb).sql).toMatch(/ur\.expires_at is null or ur\.expires_at > now\(\)/i);

      const db = fakeDb({
        heldRoles: [{ role_id: 'issuer', tenant_id: 't1', grants_all: false, actions: ['invoice.view'], expires_at: null }],
        delegations: [{ id: 'd1', granter_id: 'boss', actions: ['invoice.void'], lapsed_actions: [], expires_at: new Date('2027-01-01T00:00:00Z') }],
      });
      const e = await svc(db).explainAccess('u1', 't1');
      expect(e.effectiveActions).toEqual(['invoice.view', 'invoice.void']);
      expect(e.roles).toHaveLength(1);
      expect(e.delegations).toHaveLength(1);
      expect(e.allowed).toBeUndefined(); // no action asked
    });

    it('reports the scope (tenant-scoped vs. platform-wide) and expiry each held role was granted with', async () => {
      const expires = new Date('2027-02-01T00:00:00Z');
      const db = fakeDb({
        heldRoles: [
          { role_id: 'reviewer', tenant_id: 't1', grants_all: false, actions: ['kyc.review'], expires_at: expires },
          { role_id: 'ascendra_admin', tenant_id: null, grants_all: true, actions: [], expires_at: null },
        ],
      });
      const e = await svc(db).explainAccess('u1', 't1');
      expect(e.roles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ roleId: 'reviewer', tenantId: 't1', expiresAt: expires }),
          expect.objectContaining({ roleId: 'ascendra_admin', tenantId: null, expiresAt: null }),
        ]),
      );
    });

    it('explains an allow via role, via delegation, a lapsed delegation, and a denial', async () => {
      const db = fakeDb({
        heldRoles: [{ role_id: 'issuer', tenant_id: 't1', grants_all: false, actions: ['invoice.view'], expires_at: null }],
        delegations: [
          {
            id: 'd1', granter_id: 'boss', actions: ['invoice.void', 'payout.approve'], lapsed_actions: ['payout.approve'],
            expires_at: new Date('2027-01-01T00:00:00Z'),
          },
        ],
      });
      expect((await svc(db).explainAccess('u1', 't1', 'invoice.view')).reason).toMatch(/role 'issuer'/);
      expect((await svc(db).explainAccess('u1', 't1', 'invoice.void')).reason).toMatch(/delegation d1 from boss/);
      const lapsed = await svc(db).explainAccess('u1', 't1', 'payout.approve');
      expect(lapsed).toMatchObject({ allowed: false, reason: expect.stringContaining('no longer holds it') });
      expect(lapsed.effectiveActions).toEqual(['invoice.view', 'invoice.void']);
      const denied = await svc(db).explainAccess('u1', 't1', 'invoice.delete');
      expect(denied).toMatchObject({ allowed: false, reason: expect.stringContaining('no role or active delegation') });
    });

    it('skips the delegation query entirely for a null tenant', async () => {
      const db = fakeDb({ heldRoles: [{ role_id: 'admin', tenant_id: null, grants_all: false, actions: ['x'], expires_at: null }] });
      await svc(db).explainAccess('u1', null);
      expect(db.execute.mock.calls.some(([q]) => /commons_authz_delegation/i.test(dialect.sqlToQuery(q as SQL).sql))).toBe(false);
    });
  });

  describe('getRole / countHolders', () => {
    it('getRole maps the row when found, null otherwise', async () => {
      const db = fakeDb({
        roles: [{ id: 'issuer', description: 'Issuer', grants_all: false, actions: ['invoice.view'], platform_actions: [] }],
      });
      await expect(svc(db).getRole('issuer')).resolves.toEqual({
        id: 'issuer', description: 'Issuer', grantsAll: false, actions: ['invoice.view'], scope: 'tenant', platformActions: [],
      });

      const missing = fakeDb({ roles: [] });
      await expect(svc(missing).getRole('ghost')).resolves.toBeNull();
    });

    it('countHolders counts active holders, in one tenant when asked', async () => {
      const db = fakeDb({ holderCount: [{ count: '4' }] });
      await expect(svc(db).countHolders('issuer', 't1')).resolves.toBe(4);
      const { sql: text, params } = textOf(db);
      expect(text).toMatch(/ur\.expires_at is null or ur\.expires_at > now\(\)/i);
      expect(params).toEqual(expect.arrayContaining(['issuer', 't1']));

      const zero = fakeDb({ holderCount: [] });
      await expect(svc(zero).countHolders('ghost')).resolves.toBe(0);
    });
  });

  describe('listDelegations', () => {
    const row = (i: number) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, granter_id: 'g', grantee_id: 'u1', tenant_id: 't1',
      actions: ['a', 'b'], lapsed_actions: ['b'], expires_at: new Date('2027-01-01T00:00:00Z'), revoked_at: null,
      revoked_by: null, reason: null, created_at: new Date('2026-06-01T00:00:00Z'), created_by: 'g',
      created_at_key: '2026-06-01T00:00:00.123456Z',
    });

    it('renders status filters, reports lapsed actions, and paginates with a JSON cursor', async () => {
      const active = fakeDb();
      await svc(active).listDelegations({ status: 'active', granteeId: 'u1' });
      expect(textOf(active).sql).toMatch(/d\.revoked_at is null and d\.expires_at > now\(\)/i);
      expect(textOf(active).params).toContain('u1');

      const db = fakeDb({ delegations: Array.from({ length: 51 }, (_, i) => row(i)) });
      const page = await svc(db).listDelegations({ limit: 50 });
      expect(page.delegations).toHaveLength(50);
      expect(page.delegations[0].lapsedActions).toEqual(['b']);
      expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toEqual({
        ts: '2026-06-01T00:00:00.123456Z',
        id: row(49).id,
      });
    });

    it('leads the keyset condition with created_at, and rejects a cursor it never issued', async () => {
      const cursor = Buffer.from(JSON.stringify({ ts: '2026-06-01T00:00:00.123456Z', id: row(1).id })).toString('base64url');
      const db = fakeDb();
      await svc(db).listDelegations({ cursor });
      expect(textOf(db).sql).toMatch(/d\.created_at <= .* and \(d\.created_at < .* or d\.id < /i);
      await expect(svc(fakeDb()).listDelegations({ cursor: 'garbage' })).rejects.toBeInstanceOf(InvalidAuthzCursorError);
    });

    it('renders the expiringWithinDays predicate', async () => {
      const db = fakeDb();
      await svc(db).listDelegations({ expiringWithinDays: 7, tenantId: 't1' });
      const { sql: text, params } = textOf(db);
      expect(text).toMatch(/d\.revoked_at is null and d\.expires_at > now\(\) and d\.expires_at <= now\(\) \+ \(.* \* interval '1 day'\)/i);
      expect(params).toEqual(expect.arrayContaining(['t1', 7]));
    });

    it('getDelegation answers null for a non-uuid id without querying', async () => {
      const db = fakeDb();
      await expect(svc(db).getDelegation('not-a-uuid')).resolves.toBeNull();
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('whoCan', () => {
    it('reports roles that grant the action (directly or via grantsAll), their active holders, and live delegations', async () => {
      const db = fakeDb({
        whoCanRoles: [
          { id: 'ascendra_admin', grants_all: true, holders: ['u_1c07'] },
          { id: 'finance_approver', grants_all: false, holders: ['u_2210', 'u_9f3a'] },
        ],
        whoCanDelegations: [
          { id: 'd1', granter_id: 'u_9f3a', grantee_id: 'u_44b2', expires_at: new Date('2027-01-01T00:00:00Z') },
        ],
      });

      const result = await svc(db).whoCan('payout.approve', 't_kairos');

      expect(result).toMatchObject({ action: 'payout.approve', tenantId: 't_kairos' });
      expect(result.roles).toEqual([
        { roleId: 'ascendra_admin', grantsAll: true, holderUserIds: ['u_1c07'] },
        { roleId: 'finance_approver', grantsAll: false, holderUserIds: ['u_2210', 'u_9f3a'] },
      ]);
      expect(result.delegations).toEqual([
        { id: 'd1', granterId: 'u_9f3a', granteeId: 'u_44b2', expiresAt: new Date('2027-01-01T00:00:00Z') },
      ]);
      const delegationSql = db.execute.mock.calls.map(([q]) => dialect.sqlToQuery(q as SQL).sql).find((t) => /= any\(d\.actions\)/.test(t))!;
      expect(delegationSql).toMatch(/gur\.user_id = d\.granter_id/); // the granter must still hold it
    });

    it('reports tenantId null and skips the tenant filter when no tenant is given', async () => {
      const db = fakeDb({ whoCanRoles: [{ id: 'ascendra_admin', grants_all: true, holders: null }] });
      const result = await svc(db).whoCan('payout.approve');
      expect(result.tenantId).toBeNull();
      expect(result.roles[0].holderUserIds).toEqual([]);
      expect(textOf(db).sql).not.toMatch(/ur\.tenant_id =/i);
    });
  });

  it('exactTenantHolders reads active holders in exactly that tenant', async () => {
    const db = fakeDb({ exactHolders: [{ user_id: 'u1', role_id: 'tenant-admin' }] });
    await expect(svc(db).exactTenantHolders('authz.assign_roles', 't1')).resolves.toEqual([{ userId: 'u1', roleId: 'tenant-admin' }]);
    expect(textOf(db).sql).toMatch(/ur\.tenant_id = .* and \(ur\.expires_at is null/i);

    const global = fakeDb();
    await svc(global).exactTenantHolders('authz.platform', null);
    expect(textOf(global).sql).toMatch(/ur\.tenant_id is null/i);
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
