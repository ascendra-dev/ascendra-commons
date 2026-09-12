import type { DynamicModule } from '@nestjs/common';
import type { Actor } from '../authorization.core';

/**
 * The `@RequiresAction` gate names `authorization.api`'s endpoints declare. Fixed
 * (not `forRoot`-configurable) — `@RequiresAction` is applied at class-definition
 * time, so these must be literal. A vertical whose catalog uses different names
 * maps its admin role to *also* grant these, or writes its own thin controllers
 * against the same ports.
 */
export const AUTHZ_ACTIONS = {
  /** All observability reads (roles, assignments, delegations, explain, catalog health). */
  VIEW: 'authz.view',
  /** Assign / revoke a role for a user. */
  ASSIGN_ROLES: 'authz.assign_roles',
  /** Create / revoke a delegation. */
  MANAGE_DELEGATIONS: 'authz.manage_delegations',
  /** Edit an action's free-text catalog description. */
  MANAGE_CATALOG: 'authz.manage_catalog',
} as const;

export interface AuthzApiModuleConfig {
  /**
   * Modules exporting `AUTHZ_ADMIN_PORT`, `AUTHZ_OBSERVABILITY_PORT` and
   * `AUTHZ_DELEGATION_SERVICE` — for the common stack, a stack adapter's
   * `PostgresAuthzAdminModule` + `PostgresPermissionTableModule`. A custom
   * adapter binds under those same family tokens.
   */
  imports?: DynamicModule['imports'];
  /** Optional token an `AuthzAuditEmitter` is provided under (bound in `imports`). Omit → mutations are not audited. */
  auditEmitterToken?: string | symbol | (new (...args: never[]) => unknown);
  /** The app's full action catalog — `Object.values(Actions)`. Used by `GET /authz/action-catalog/health`. */
  actionCatalog: readonly string[];
  /**
   * Is this actor a platform admin (may assign roles in any tenant, may assign
   * `grantsAll` roles)? Default: `actor.tenantId === null`.
   */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
}

/** The shape bound under `AUTHZ_API_OPTIONS`. */
export interface AuthzApiOptions {
  actionCatalog: readonly string[];
  isPlatformAdmin: (actor: Actor) => boolean | Promise<boolean>;
}

export function resolveAuthzApiOptions(config: AuthzApiModuleConfig): AuthzApiOptions {
  return {
    actionCatalog: config.actionCatalog,
    isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null),
  };
}
