import { DynamicModule, Module } from '@nestjs/common';
import { PostgresAdvisoryLock } from './postgres-advisory-lock';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { ADVISORY_LOCK, SQL_EXECUTOR } from './tokens';

export interface BackgroundJobsModuleConfig {
  /**
   * The injection token the consuming app already provides its Drizzle db
   * client under. This library never provides its own database connection —
   * it aliases the consumer's existing one via useExisting, the same
   * reasoning AuthorizationModule uses for AUTHORIZER.
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Whatever module(s) export the provider behind sqlExecutorToken.
   * useExisting only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not anywhere in the wider
   * application graph — so the consumer's db module has to be named here
   * explicitly. Omit only if that provider's own module is marked
   * `global: true`.
   */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — requires config because there's no sensible default for
 * which provider is the consumer's db client, unlike domain-events, whose only
 * knob (transport) has a sensible default.
 *
 * Does not schedule anything itself — no @Cron, no OnApplicationBootstrap.
 * It only provides IdempotentJobRunner; each job gets its own thin wiring
 * class deciding when to call runner.run(job), since different jobs may need
 * different cadences. See this module's README.
 */
@Module({})
export class BackgroundJobsModule {
  static forRoot(config: BackgroundJobsModuleConfig): DynamicModule {
    return {
      module: BackgroundJobsModule,
      imports: config.imports ?? [],
      providers: [
        { provide: SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresAdvisoryLock,
        { provide: ADVISORY_LOCK, useExisting: PostgresAdvisoryLock },
        IdempotentJobRunner,
      ],
      exports: [IdempotentJobRunner],
    };
  }
}
