import { DynamicModule, Module } from '@nestjs/common';
import { DelegationService } from './delegation.service';
import { PermissionLoader } from './permission-loader';
import { PostgresPermissionTableAuthorizer } from './postgres-permission-table-authorizer';
import {
  AUTHZ_DELEGATION_OPTIONS,
  AUTHZ_DELEGATION_SERVICE,
  AUTHZ_SQL_EXECUTOR,
  POSTGRES_PERMISSION_TABLE_AUTHORIZER,
} from './tokens';

export interface PostgresAuthorizationModuleConfig {
  /**
   * The injection token the consuming app already provides its Drizzle db
   * client under. Aliased via `useExisting`, never constructed here.
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Hard cap on delegation lifetime, in days. Default 90. There are no
   * indefinite delegations — every `delegate()` call must set `expiresAt`
   * within this window.
   */
  maxDelegationDays?: number;

  /**
   * Whatever module(s) export the provider behind `sqlExecutorToken`.
   * `useExisting` only resolves a token NestJS can already see in *this*
   * module's own providers or imports.
   */
  imports?: DynamicModule['imports'];
}

/**
 * Wires the Postgres/Drizzle Model 2 authorizer and the delegation service, and
 * exports:
 *  - `POSTGRES_PERMISSION_TABLE_AUTHORIZER` — pass to
 *    `AuthorizationModule.forRoot({ model: 'permission-table', authorizerToken })`
 *  - `AUTHZ_DELEGATION_SERVICE` — inject where you manage delegations
 *
 * ```typescript
 * AuthorizationModule.forRoot({
 *   model: 'permission-table',
 *   authorizerToken: POSTGRES_PERMISSION_TABLE_AUTHORIZER,
 *   imports: [
 *     PostgresAuthorizationModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION,
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 */
@Module({})
export class PostgresAuthorizationModule {
  static forRoot(config: PostgresAuthorizationModuleConfig): DynamicModule {
    return {
      module: PostgresAuthorizationModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUTHZ_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        {
          provide: AUTHZ_DELEGATION_OPTIONS,
          useValue: { maxDelegationDays: config.maxDelegationDays ?? 90 },
        },
        PermissionLoader,
        PostgresPermissionTableAuthorizer,
        { provide: POSTGRES_PERMISSION_TABLE_AUTHORIZER, useExisting: PostgresPermissionTableAuthorizer },
        DelegationService,
        { provide: AUTHZ_DELEGATION_SERVICE, useExisting: DelegationService },
      ],
      exports: [POSTGRES_PERMISSION_TABLE_AUTHORIZER, AUTHZ_DELEGATION_SERVICE],
    };
  }
}
