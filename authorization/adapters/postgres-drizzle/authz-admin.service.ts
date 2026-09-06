import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SqlExecutor } from './sql-executor';
import { AUTHZ_SQL_EXECUTOR } from './tokens';

/** Thrown by `assignRole` when the `roleId` has no `commons_authz_role` row. */
export class RoleNotFoundError extends Error {
  constructor(public readonly roleId: string) {
    super(`No role '${roleId}' in the role catalog.`);
    this.name = 'RoleNotFoundError';
  }
}

/** Thrown by `setActionDescription` when the action has no `commons_authz_action` row (run `syncActions()` first). */
export class ActionNotFoundError extends Error {
  constructor(public readonly action: string) {
    super(`No action '${action}' in the action catalog.`);
    this.name = 'ActionNotFoundError';
  }
}

export interface AssignRoleInput {
  userId: string;
  /** `null` = grant the role in every tenant (a platform admin). */
  tenantId: string | null;
  roleId: string;
  /** Who performed the assignment — recorded in `granted_by`. */
  grantedBy: string;
}

export interface RevokeRoleInput {
  userId: string;
  tenantId: string | null;
  roleId: string;
}

/**
 * The narrow set of authorization mutations an admin screen needs. Role→permission
 * editing is deliberately **not** here — that's platform-admin territory,
 * typically `REVOKE`d from the app role at the database (see the adapter README)
 * and changed by migration/seed, not a runtime API. Delegation create/revoke
 * lives in `DelegationService`.
 *
 * Every method is a single statement. Audit is the consumer's to wire — call
 * these from a controller and emit an `AuditRecordRaised` there.
 */
@Injectable()
export class PostgresAuthzAdminService {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  /** Idempotent — assigning a role the user already holds (same tenant) is a no-op. */
  async assignRole(input: AssignRoleInput): Promise<void> {
    const { rows } = await this.db.execute<{ id: string }>(
      sql`select id from commons_authz_role where id = ${input.roleId}`,
    );
    if (rows.length === 0) throw new RoleNotFoundError(input.roleId);

    await this.db.execute(sql`
      insert into commons_authz_user_role (user_id, tenant_id, role_id, granted_by)
      values (${input.userId}, ${input.tenantId}, ${input.roleId}, ${input.grantedBy})
      on conflict on constraint commons_authz_user_role_uq do nothing
    `);
  }

  /** Idempotent — revoking a role the user doesn't hold is a no-op. */
  async revokeRole(input: RevokeRoleInput): Promise<void> {
    const tenantCond =
      input.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${input.tenantId}`;
    await this.db.execute(sql`
      delete from commons_authz_user_role
      where user_id = ${input.userId} and role_id = ${input.roleId} and ${tenantCond}
    `);
  }

  /** Fill in (or clear) the free-text description of a catalog action. */
  async setActionDescription(action: string, description: string | null): Promise<void> {
    const { rows } = await this.db.execute<{ name: string }>(sql`
      update commons_authz_action set description = ${description}
      where name = ${action}
      returning name
    `);
    if (rows.length === 0) throw new ActionNotFoundError(action);
  }
}
