import { DynamicModule, Module } from '@nestjs/common';
import { PostgresAuthzAdminService } from './authz-admin.service';
import { PostgresAuthzObservabilityService } from './authz-observability.service';
import { AUTHZ_SQL_EXECUTOR, POSTGRES_AUTHZ_ADMIN, POSTGRES_AUTHZ_OBSERVABILITY } from './tokens';

export interface PostgresAuthzAdminModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Wires the authorization admin surface for a role-management screen:
 *
 *  - `POSTGRES_AUTHZ_OBSERVABILITY` — `PostgresAuthzObservabilityService`:
 *    `listRoles`, `listUserRoleAssignments`, `explainAccess`, `listDelegations`,
 *    `actionCatalogHealth`. Read-only.
 *  - `POSTGRES_AUTHZ_ADMIN` — `PostgresAuthzAdminService`: `assignRole`,
 *    `revokeRole`, `setActionDescription`.
 *
 * Independent of `PostgresAuthorizationModule` — import either or both (both
 * take the same `sqlExecutorToken`). Delegation create/revoke stays in
 * `DelegationService` (from `PostgresAuthorizationModule`).
 *
 * The endpoints are the consumer's, gated with their own `Authorizer` on a
 * dedicated action (e.g. `'authz.manage'`, a platform-admin persona).
 */
@Module({})
export class PostgresAuthzAdminModule {
  static forRoot(config: PostgresAuthzAdminModuleConfig): DynamicModule {
    return {
      module: PostgresAuthzAdminModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUTHZ_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresAuthzObservabilityService,
        { provide: POSTGRES_AUTHZ_OBSERVABILITY, useExisting: PostgresAuthzObservabilityService },
        PostgresAuthzAdminService,
        { provide: POSTGRES_AUTHZ_ADMIN, useExisting: PostgresAuthzAdminService },
      ],
      exports: [POSTGRES_AUTHZ_OBSERVABILITY, POSTGRES_AUTHZ_ADMIN],
    };
  }
}
