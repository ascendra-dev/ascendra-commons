import { DynamicModule, Module } from '@nestjs/common';
import { PostgresAuditEventReader } from './postgres-audit-event-reader';
import { AUDIT_APPLICATION_ID, AUDIT_SQL_EXECUTOR, POSTGRES_AUDIT_EVENT_READER } from './tokens';

export interface PostgresAuditObservabilityModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Which Ascendra application this process is — every query is scoped to it. */
  application: string;

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_audit_event` for a compliance/ops admin
 * screen — `AuditEventReader.find(query)`. Exports `POSTGRES_AUDIT_EVENT_READER`;
 * the consumer writes the endpoint and gates it with its own `Authorizer` on a
 * dedicated action (e.g. `'audit.view'`, restricted to a platform/compliance
 * persona — never a tenant user).
 *
 * Independent of `PostgresAuditPersistenceModule` — import either or both. Both
 * take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresAuditObservabilityModule {
  static forRoot(config: PostgresAuditObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresAuditObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUDIT_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: AUDIT_APPLICATION_ID, useValue: config.application },
        PostgresAuditEventReader,
        { provide: POSTGRES_AUDIT_EVENT_READER, useExisting: PostgresAuditEventReader },
      ],
      exports: [POSTGRES_AUDIT_EVENT_READER],
    };
  }
}
