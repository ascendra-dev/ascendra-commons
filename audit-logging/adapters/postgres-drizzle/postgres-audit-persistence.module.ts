import { DynamicModule, Module } from '@nestjs/common';
import { PostgresAuditEventRepository } from './postgres-audit-event.repository';
import { AUDIT_APPLICATION_ID, AUDIT_SQL_EXECUTOR, POSTGRES_AUDIT_EVENT_REPOSITORY } from './tokens';

export interface PostgresAuditPersistenceModuleConfig {
  /**
   * The injection token the consuming app already provides its Drizzle db
   * client under. Aliased via `useExisting`, never constructed here — this
   * library never owns a database connection (same reasoning
   * `BackgroundJobsModule.forRoot()` / `IdempotencyModule.forRoot()` give).
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Which Ascendra application this process is (e.g. `'ascendra-pay'`) —
   * stamped into every audit row's `application` column. The same string the
   * consumer passes to `DomainEventsModule.forRoot({ application })`; supplied
   * here as a plain value so this adapter doesn't depend on that token being
   * bound and exported.
   */
  application: string;

  /**
   * Whatever module(s) export the provider behind `sqlExecutorToken`.
   * `useExisting` only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not the wider application graph. Omit
   * only if that provider's own module is `global: true`.
   */
  imports?: DynamicModule['imports'];
}

/**
 * Wires the reference `PostgresAuditEventRepository` and exports it under
 * `POSTGRES_AUDIT_EVENT_REPOSITORY`. Pass that token — and this module in the
 * same `imports` array — to `AuditLoggingModule.forRoot()`:
 *
 * ```typescript
 * AuditLoggingModule.forRoot({
 *   auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
 *   imports: [
 *     PostgresAuditPersistenceModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION,
 *       application: 'ascendra-pay',
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 *
 * A dynamic module because neither the db token nor the application string has
 * a sensible default.
 */
@Module({})
export class PostgresAuditPersistenceModule {
  static forRoot(config: PostgresAuditPersistenceModuleConfig): DynamicModule {
    return {
      module: PostgresAuditPersistenceModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUDIT_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: AUDIT_APPLICATION_ID, useValue: config.application },
        PostgresAuditEventRepository,
        { provide: POSTGRES_AUDIT_EVENT_REPOSITORY, useExisting: PostgresAuditEventRepository },
      ],
      exports: [POSTGRES_AUDIT_EVENT_REPOSITORY],
    };
  }
}
