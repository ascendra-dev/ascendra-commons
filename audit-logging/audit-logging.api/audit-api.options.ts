import type { DynamicModule } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';

/**
 * The `@RequiresAction` gate name `audit-logging.api`'s endpoints declare. Fixed
 * — `@RequiresAction` is applied at class-definition time. Restrict `audit.view`
 * to a compliance / platform-admin persona (and, if you want a per-tenant
 * activity feed, tenant-admin personas — those calls are auto-scoped to the
 * actor's own tenant, see below).
 */
export const AUDIT_ACTIONS = {
  VIEW: 'audit.view',
} as const;

export interface AuditApiModuleConfig {
  /** Modules exporting `AUDIT_EVENT_READER` — a stack adapter's `PostgresAuditObservabilityModule`. */
  imports?: DynamicModule['imports'];
  /**
   * Is this actor a platform admin (may read **every** tenant's audit records,
   * and platform-level `tenant_id IS NULL` rows)? Default: `actor.tenantId === null`.
   * A non-platform actor's reads are forced to their own `tenantId`.
   */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
}

/** The shape bound under `AUDIT_API_OPTIONS`. */
export interface AuditApiOptions {
  isPlatformAdmin: (actor: Actor) => boolean | Promise<boolean>;
}

export function resolveAuditApiOptions(config: AuditApiModuleConfig): AuditApiOptions {
  return { isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null) };
}
