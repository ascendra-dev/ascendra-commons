import { DynamicModule, Module } from '@nestjs/common';
import { AUDIT_EVENT_REPOSITORY } from './tokens';

export interface AuditLoggingModuleConfig {
  /** The injection token the consumer's own AuditEventRepository implementation is already provided under. */
  auditEventRepositoryToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Whatever module(s) export the provider behind auditEventRepositoryToken.
   * useExisting only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not anywhere in the wider
   * application graph — the same reason BackgroundJobsModule.forRoot() needs
   * this field. Omit only if that provider's own module is global: true.
   */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — requires config because there's no default for which
 * provider is the consumer's audit repository. Does not ship a listener —
 * see this pattern's README for why: which event names to audit is
 * project-specific, so the consumer writes their own small listener class
 * (using @OnCriticalEvent() and persistAuditRecord()) and imports this
 * module to get AUDIT_EVENT_REPOSITORY injectable into it.
 */
@Module({})
export class AuditLoggingModule {
  static forRoot(config: AuditLoggingModuleConfig): DynamicModule {
    return {
      module: AuditLoggingModule,
      imports: config.imports ?? [],
      providers: [{ provide: AUDIT_EVENT_REPOSITORY, useExisting: config.auditEventRepositoryToken }],
      exports: [AUDIT_EVENT_REPOSITORY],
    };
  }
}
