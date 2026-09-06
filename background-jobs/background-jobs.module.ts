import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { PostgresAdvisoryLock } from './postgres-advisory-lock';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { JobTrigger } from './job-trigger';
import { NoopJobRunRecorder } from './noop-job-run-recorder';
import { ScheduledJob } from './scheduled-job.interface';
import { ScheduledJobRegistry } from './scheduled-job-registry';
import { ADVISORY_LOCK, JOB_RUN_RECORDER, SQL_EXECUTOR } from './tokens';

export interface BackgroundJobsModuleConfig {
  /**
   * The injection token the consuming app provides its Drizzle db client
   * under — used by the default session-level `PostgresAdvisoryLock`, which
   * requires it to be a **dedicated single connection** (see the README).
   *
   * Required **unless** `advisoryLockToken` is given: a lease-table lock
   * (`POSTGRES_LEASE_LOCK`) brings its own db wiring, and this module needs no
   * `SqlExecutor` of its own in that case.
   */
  sqlExecutorToken?: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Optional. The token an alternative `AdvisoryLock` implementation is
   * provided under — e.g. `POSTGRES_LEASE_LOCK` from
   * `adapters/postgres-drizzle`, the pool-safe lease-table lock. Omit and the
   * session-level `PostgresAdvisoryLock` is used (and `sqlExecutorToken`
   * becomes required). Whatever module exports this token must be in `imports`.
   */
  advisoryLockToken?: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Whatever module(s) export the provider behind sqlExecutorToken.
   * useExisting only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not anywhere in the wider
   * application graph — so the consumer's db module has to be named here
   * explicitly. Omit only if that provider's own module is marked
   * `global: true`.
   */
  imports?: DynamicModule['imports'];

  /**
   * Optional. The token a `JobRunRecorder` implementation is provided under —
   * e.g. `POSTGRES_JOB_RUN_RECORDER` from `adapters/postgres-drizzle`. Omit and
   * run-history recording is a no-op (`NoopJobRunRecorder`). Whatever module
   * exports this token must be in `imports` — same `useExisting` visibility
   * rule as `sqlExecutorToken`.
   */
  jobRunRecorderToken?: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Optional. `ScheduledJob` provider classes an admin can run on demand by
   * name via `JobTrigger` — the hook behind a "run now" / "retry" button. Each
   * must be resolvable from `imports` (its own feature module, which must
   * `exports` it). A job left out of this list still runs on its `@Cron`
   * schedule; it just can't be triggered out of schedule. Defaults to none.
   */
  jobs?: Array<Type<ScheduledJob<unknown>>>;
}

/**
 * A dynamic module — requires config because there's no sensible default for
 * which provider is the consumer's db client (the same reasoning
 * `NotificationModule.forRoot()` gives for its own required config — see that
 * module's own doc comment).
 *
 * Does not schedule anything itself — no @Cron, no OnApplicationBootstrap.
 * It provides IdempotentJobRunner (each job gets its own thin wiring class
 * deciding when to call runner.run(job), since different jobs may need
 * different cadences), plus JobTrigger + ScheduledJobRegistry for
 * admin-initiated out-of-schedule runs. See this module's README.
 */
@Module({})
export class BackgroundJobsModule {
  static forRoot(config: BackgroundJobsModuleConfig): DynamicModule {
    const recorderProvider: Provider = config.jobRunRecorderToken
      ? { provide: JOB_RUN_RECORDER, useExisting: config.jobRunRecorderToken }
      : { provide: JOB_RUN_RECORDER, useClass: NoopJobRunRecorder };

    const registryProvider: Provider = {
      provide: ScheduledJobRegistry,
      useFactory: (...jobs: ScheduledJob<unknown>[]) => new ScheduledJobRegistry(jobs),
      inject: config.jobs ?? [],
    };

    let lockProviders: Provider[];
    if (config.advisoryLockToken) {
      lockProviders = [{ provide: ADVISORY_LOCK, useExisting: config.advisoryLockToken }];
    } else {
      if (!config.sqlExecutorToken) {
        throw new Error(
          'BackgroundJobsModule.forRoot: sqlExecutorToken is required unless advisoryLockToken is provided.',
        );
      }
      lockProviders = [
        { provide: SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresAdvisoryLock,
        { provide: ADVISORY_LOCK, useExisting: PostgresAdvisoryLock },
      ];
    }

    return {
      module: BackgroundJobsModule,
      imports: config.imports ?? [],
      providers: [
        ...lockProviders,
        recorderProvider,
        IdempotentJobRunner,
        registryProvider,
        JobTrigger,
      ],
      exports: [IdempotentJobRunner, JobTrigger, ScheduledJobRegistry],
    };
  }
}
