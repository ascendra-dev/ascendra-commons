import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { SqlExecutor } from './sql-executor';
import { AUTHZ_SQL_EXECUTOR } from './tokens';
import type {
  AccessExplanation,
  ActionCatalogHealth,
  DelegationPage,
  DelegationQuery,
  DelegationView,
  RoleView,
  UserRoleAssignment,
} from './authz-admin.types';

const DEFAULT_DELEGATION_LIMIT = 50;
const MAX_DELEGATION_LIMIT = 200;
const MAX_ASSIGNMENT_ROWS = 2000;

/**
 * Read-only reporting over the `commons_authz_*` tables for an admin screen —
 * the role catalog, who holds what, "why can/can't user X do action Y", the
 * delegation ledger, and action-catalog drift. Never mutates; writes live in
 * `PostgresAuthzAdminService`. No `application` column exists on these tables
 * (the role catalog is project-specific — `MODULE-STANDARD.md` dimension 4).
 */
@Injectable()
export class PostgresAuthzObservabilityService {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  /** Every role with its granted actions. */
  async listRoles(): Promise<RoleView[]> {
    const { rows } = await this.db.execute<{
      id: string;
      description: string | null;
      grants_all: boolean;
      actions: string[];
    }>(sql`
      select r.id, r.description, r.grants_all,
             coalesce(array_agg(rp.action) filter (where rp.action is not null), '{}') as actions
      from commons_authz_role r
      left join commons_authz_role_permission rp on rp.role_id = r.id
      group by r.id, r.description, r.grants_all
      order by r.id
    `);
    return rows.map((r) => ({
      id: r.id,
      description: r.description,
      grantsAll: r.grants_all,
      actions: r.grants_all ? [] : [...(r.actions ?? [])].sort(),
    }));
  }

  /** Role assignments, filtered. Returns up to 2000 rows — narrow the filter for a broad query. */
  async listUserRoleAssignments(query: {
    userId?: string;
    tenantId?: string | null;
    roleId?: string;
  } = {}): Promise<UserRoleAssignment[]> {
    const conds: SQL[] = [];
    if (query.userId !== undefined) conds.push(sql`user_id = ${query.userId}`);
    if ('tenantId' in query) {
      conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    }
    if (query.roleId !== undefined) conds.push(sql`role_id = ${query.roleId}`);
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const { rows } = await this.db.execute<{
      user_id: string;
      tenant_id: string | null;
      role_id: string;
      granted_at: string | Date;
      granted_by: string | null;
    }>(sql`
      select user_id, tenant_id, role_id, granted_at, granted_by
      from commons_authz_user_role
      ${where}
      order by granted_at desc
      limit ${MAX_ASSIGNMENT_ROWS}
    `);
    return rows.map((r) => ({
      userId: r.user_id,
      tenantId: r.tenant_id,
      roleId: r.role_id,
      grantedAt: asDate(r.granted_at),
      grantedBy: r.granted_by,
    }));
  }

  /** "Can this user do `action` (if given), and why." */
  async explainAccess(userId: string, tenantId: string | null, action?: string): Promise<AccessExplanation> {
    const roleWhere =
      tenantId === null
        ? sql`ur.user_id = ${userId} and ur.tenant_id is null`
        : sql`ur.user_id = ${userId} and (ur.tenant_id = ${tenantId} or ur.tenant_id is null)`;

    const { rows: roleRows } = await this.db.execute<{
      role_id: string;
      grants_all: boolean;
      actions: string[];
    }>(sql`
      select ur.role_id, r.grants_all,
             coalesce(array_agg(rp.action) filter (where rp.action is not null), '{}') as actions
      from commons_authz_user_role ur
      join commons_authz_role r on r.id = ur.role_id
      left join commons_authz_role_permission rp on rp.role_id = r.id
      where ${roleWhere}
      group by ur.role_id, r.grants_all
      order by ur.role_id
    `);

    const roles = roleRows.map((r) => ({
      roleId: r.role_id,
      grantsAll: r.grants_all,
      grantedActions: r.grants_all ? [] : [...(r.actions ?? [])].sort(),
    }));

    let delegations: AccessExplanation['delegations'] = [];
    if (tenantId !== null) {
      const { rows: delRows } = await this.db.execute<{
        id: string;
        granter_id: string;
        actions: string[];
        expires_at: string | Date;
      }>(sql`
        select id, granter_id, actions, expires_at
        from commons_authz_delegation
        where grantee_id = ${userId} and tenant_id = ${tenantId}
          and revoked_at is null and expires_at > now()
        order by created_at desc
      `);
      delegations = delRows.map((d) => ({
        id: d.id,
        granterId: d.granter_id,
        actions: d.actions,
        expiresAt: asDate(d.expires_at),
      }));
    }

    const grantsAllRole = roles.find((r) => r.grantsAll);
    const effectiveActions: string[] | '*' = grantsAllRole
      ? '*'
      : [...new Set([...roles.flatMap((r) => r.grantedActions), ...delegations.flatMap((d) => d.actions)])].sort();

    const explanation: AccessExplanation = { userId, tenantId, roles, delegations, effectiveActions };
    if (action !== undefined) {
      explanation.action = action;
      if (grantsAllRole) {
        explanation.allowed = true;
        explanation.reason = `granted by role '${grantsAllRole.roleId}' (grants all actions)`;
      } else {
        const viaRole = roles.find((r) => r.grantedActions.includes(action));
        const viaDelegation = delegations.find((d) => d.actions.includes(action));
        if (viaRole) {
          explanation.allowed = true;
          explanation.reason = `granted by role '${viaRole.roleId}'`;
        } else if (viaDelegation) {
          explanation.allowed = true;
          explanation.reason = `granted by delegation ${viaDelegation.id} from ${viaDelegation.granterId} (expires ${viaDelegation.expiresAt.toISOString()})`;
        } else {
          explanation.allowed = false;
          explanation.reason = `denied — no role or active delegation grants '${action}'`;
        }
      }
    }
    return explanation;
  }

  /** The delegation ledger, filtered, newest first, keyset-paginated. */
  async listDelegations(query: DelegationQuery = {}): Promise<DelegationPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_DELEGATION_LIMIT), MAX_DELEGATION_LIMIT);
    const conds: SQL[] = [];
    if (query.granterId !== undefined) conds.push(sql`granter_id = ${query.granterId}`);
    if (query.granteeId !== undefined) conds.push(sql`grantee_id = ${query.granteeId}`);
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    if (query.status === 'active') conds.push(sql`revoked_at is null and expires_at > now()`);
    else if (query.status === 'revoked') conds.push(sql`revoked_at is not null`);
    else if (query.status === 'expired') conds.push(sql`revoked_at is null and expires_at <= now()`);

    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      conds.push(sql`(created_at < ${cursor.createdAt} or (created_at = ${cursor.createdAt} and id < ${cursor.id}))`);
    }
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const { rows } = await this.db.execute<DelegationRow>(sql`
      select id, granter_id, grantee_id, tenant_id, actions, expires_at, revoked_at, revoked_by, reason, created_at, created_by
      from commons_authz_delegation
      ${where}
      order by created_at desc, id desc
      limit ${limit + 1}
    `);
    const all = rows.map(toDelegationView);
    if (all.length > limit) {
      const delegations = all.slice(0, limit);
      const last = delegations[delegations.length - 1];
      return { delegations, nextCursor: encodeCursor(last.createdAt, last.id) };
    }
    return { delegations: all };
  }

  /** Drift between the app's `Actions` catalog and the `commons_authz_action` table. */
  async actionCatalogHealth(knownActions: readonly string[]): Promise<ActionCatalogHealth> {
    const { rows: actionRows } = await this.db.execute<{ name: string; description: string | null }>(
      sql`select name, description from commons_authz_action`,
    );
    const { rows: grantedRows } = await this.db.execute<{ action: string }>(
      sql`select distinct action from commons_authz_role_permission`,
    );

    const known = new Set(knownActions);
    const inDb = new Set(actionRows.map((r) => r.name));
    const granted = new Set(grantedRows.map((r) => r.action));
    const undescribed = new Set(
      actionRows.filter((r) => r.description === null || r.description.trim() === '').map((r) => r.name),
    );

    return {
      inCodeNotInDb: [...known].filter((a) => !inDb.has(a)).sort(),
      inDbNotInCode: [...inDb].filter((a) => !known.has(a)).sort(),
      grantedButUndescribed: [...granted].filter((a) => undescribed.has(a)).sort(),
      describedCount: actionRows.length - undescribed.size,
      totalCount: actionRows.length,
    };
  }
}

interface DelegationRow {
  id: string;
  granter_id: string;
  grantee_id: string;
  tenant_id: string;
  actions: string[];
  expires_at: string | Date;
  revoked_at: string | Date | null;
  revoked_by: string | null;
  reason: string | null;
  created_at: string | Date;
  created_by: string;
}

function toDelegationView(row: DelegationRow): DelegationView {
  const expiresAt = asDate(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : asDate(row.revoked_at);
  const status: DelegationView['status'] = revokedAt
    ? 'revoked'
    : expiresAt.getTime() <= Date.now()
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    granterId: row.granter_id,
    granteeId: row.grantee_id,
    tenantId: row.tenant_id,
    actions: row.actions,
    expiresAt,
    revokedAt,
    revokedBy: row.revoked_by,
    reason: row.reason,
    createdAt: asDate(row.created_at),
    createdBy: row.created_by,
    status,
  };
}

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { createdAt: new Date(ts), id };
  } catch {
    return null;
  }
}
