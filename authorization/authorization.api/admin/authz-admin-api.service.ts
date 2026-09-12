import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  AUTHZ_ADMIN_PORT,
  AUTHZ_OBSERVABILITY_PORT,
  RoleNotFoundError,
  type AuthzAdminPort,
  type AuthzObservabilityPort,
} from '../../authorization.core.permission-table';
import { AUTHZ_API_OPTIONS, AUTHZ_AUDIT_EMITTER } from '../tokens';
import type { AuthzApiOptions } from '../authz-api.options';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { AssignRoleBody, RevokeRoleBody } from '../dto/authz-api.dto';

/**
 * The actor-scoped rules `@RequiresAction('authz.assign_roles')` can't express,
 * plus audit emission. Sits between the controller and `AuthzAdminPort`:
 *
 *  - **Tenant ceiling** — a non-platform admin may only assign/revoke within
 *    their own tenant; the request body's `tenantId` is ignored (or must match).
 *  - **Role ceiling** — only a platform admin may assign a `grantsAll` role.
 *  - **`grantedBy`** is always the request actor, never client-supplied.
 */
@Injectable()
export class AuthzAdminApiService {
  constructor(
    @Inject(AUTHZ_ADMIN_PORT) private readonly admin: AuthzAdminPort,
    @Inject(AUTHZ_OBSERVABILITY_PORT) private readonly observability: AuthzObservabilityPort,
    @Inject(AUTHZ_API_OPTIONS) private readonly options: AuthzApiOptions,
    @Inject(AUTHZ_AUDIT_EMITTER) private readonly audit: AuthzAuditEmitter,
  ) {}

  async assignRole(actor: Actor, body: AssignRoleBody): Promise<void> {
    const tenantId = await this.resolveTargetTenant(actor, body.tenantId);
    await this.assertRoleAssignable(actor, body.roleId);

    await this.admin.assignRole({ userId: body.userId, tenantId, roleId: body.roleId, grantedBy: actor.id });
    await this.audit.record({
      action: 'authz.role_assigned',
      actorId: actor.id,
      tenantId,
      entityType: 'user_role',
      entityId: `${body.userId}:${body.roleId}`,
      after: { userId: body.userId, tenantId, roleId: body.roleId },
    });
  }

  async revokeRole(actor: Actor, body: RevokeRoleBody): Promise<void> {
    const tenantId = await this.resolveTargetTenant(actor, body.tenantId);

    await this.admin.revokeRole({ userId: body.userId, tenantId, roleId: body.roleId });
    await this.audit.record({
      action: 'authz.role_revoked',
      actorId: actor.id,
      tenantId,
      entityType: 'user_role',
      entityId: `${body.userId}:${body.roleId}`,
      before: { userId: body.userId, tenantId, roleId: body.roleId },
    });
  }

  async setActionDescription(actor: Actor, action: string, description: string | null): Promise<void> {
    await this.admin.setActionDescription(action, description);
    await this.audit.record({
      action: 'authz.action_described',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'action_catalog',
      entityId: action,
      after: { description },
    });
  }

  /** A non-platform admin is pinned to their own tenant; a platform admin may target any (or `null`). */
  private async resolveTargetTenant(actor: Actor, requested: string | null | undefined): Promise<string | null> {
    if (await this.options.isPlatformAdmin(actor)) {
      return requested === undefined ? actor.tenantId : requested;
    }
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped admin must act within a tenant');
    }
    if (requested !== undefined && requested !== actor.tenantId) {
      throw new ForbiddenException('cannot assign roles outside your own tenant');
    }
    return actor.tenantId;
  }

  private async assertRoleAssignable(actor: Actor, roleId: string): Promise<void> {
    const role = (await this.observability.listRoles()).find((r) => r.id === roleId);
    if (!role) throw new RoleNotFoundError(roleId);
    if (role.grantsAll && !(await this.options.isPlatformAdmin(actor))) {
      throw new ForbiddenException(`only a platform admin may assign the '${roleId}' role`);
    }
  }
}
