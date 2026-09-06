import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Actor } from '../../authorization.types';
import { memoizePermissionLookup } from './permission-cache';
import type { SqlExecutor } from './sql-executor';
import { AUTHZ_SQL_EXECUTOR } from './tokens';

/** An actor's resolved permissions from one source. `grantsAll` short-circuits `actions`. */
export interface ResolvedPermissions {
  actions: ReadonlySet<string>;
  grantsAll: boolean;
}

function cacheKey(prefix: string, actor: Actor): string {
  return `${prefix}:${actor.id}:${actor.tenantId ?? ''}`;
}

/**
 * All the SQL reads the authorizer and the delegation service need, behind the
 * per-request cache. Shared by both so the "what does this user hold from
 * roles" query has one implementation — the delegation service needs it for
 * its grant-time check, the authorizer for `can()`.
 */
@Injectable()
export class PermissionLoader {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  /** Actions granted by the actor's assigned roles (in this tenant, or globally). Excludes delegations. */
  rolePermissions(actor: Actor): Promise<ResolvedPermissions> {
    return memoizePermissionLookup(cacheKey('role', actor), async () => {
      const { rows } = await this.db.execute<{ action: string | null; grants_all: boolean }>(sql`
        SELECT rp.action, bool_or(r.grants_all) OVER () AS grants_all
        FROM commons_authz_user_role ur
        JOIN commons_authz_role r ON r.id = ur.role_id
        LEFT JOIN commons_authz_role_permission rp ON rp.role_id = r.id
        WHERE ur.user_id = ${actor.id}
          AND (ur.tenant_id = ${actor.tenantId} OR ur.tenant_id IS NULL)
      `);
      return {
        grantsAll: rows.some((r) => r.grants_all),
        actions: new Set(rows.map((r) => r.action).filter((a): a is string => a !== null)),
      };
    });
  }

  /** Actions delegated to the actor that are still active (not revoked, not expired). */
  delegatedActions(actor: Actor): Promise<ReadonlySet<string>> {
    return memoizePermissionLookup(cacheKey('deleg', actor), async () => {
      if (actor.tenantId === null) return new Set<string>(); // delegation is always within a tenant
      const { rows } = await this.db.execute<{ action: string }>(sql`
        SELECT DISTINCT unnest(actions) AS action
        FROM commons_authz_delegation
        WHERE grantee_id = ${actor.id}
          AND tenant_id = ${actor.tenantId}
          AND revoked_at IS NULL
          AND expires_at > now()
      `);
      return new Set(rows.map((r) => r.action));
    });
  }

  /** Roles ∪ active delegations — what `can()` / `allowedActions()` answer against. */
  async effectivePermissions(actor: Actor): Promise<ResolvedPermissions> {
    const [roles, delegated] = await Promise.all([this.rolePermissions(actor), this.delegatedActions(actor)]);
    if (roles.grantsAll) return roles;
    return { grantsAll: false, actions: new Set([...roles.actions, ...delegated]) };
  }
}
