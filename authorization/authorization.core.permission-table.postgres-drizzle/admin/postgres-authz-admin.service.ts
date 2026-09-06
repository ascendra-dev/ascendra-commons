import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ActionNotFoundError,
  RoleNotFoundError,
  type AssignRoleInput,
  type AuthzAdminPort,
  type RevokeRoleInput,
} from '../../authorization.core.permission-table';
import type { SqlExecutor } from '../persistence/sql-executor';
import { AUTHZ_SQL_EXECUTOR } from '../tokens';

/**
 * `AuthzAdminPort` for Postgres/Drizzle. Every method is a single statement.
 * Role→permission editing is deliberately not here (see the adapter README's
 * "security split"); delegation create/revoke is `DelegationService`. Audit is
 * `authorization.api`'s to wire.
 */
@Injectable()
export class PostgresAuthzAdminService implements AuthzAdminPort {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

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

  async revokeRole(input: RevokeRoleInput): Promise<void> {
    const tenantCond = input.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${input.tenantId}`;
    await this.db.execute(sql`
      delete from commons_authz_user_role
      where user_id = ${input.userId} and role_id = ${input.roleId} and ${tenantCond}
    `);
  }

  async setActionDescription(action: string, description: string | null): Promise<void> {
    const { rows } = await this.db.execute<{ name: string }>(sql`
      update commons_authz_action set description = ${description}
      where name = ${action}
      returning name
    `);
    if (rows.length === 0) throw new ActionNotFoundError(action);
  }
}
