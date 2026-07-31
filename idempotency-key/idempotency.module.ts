import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ActorScopeResolver } from './actor-scope-resolver';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_SCOPE_RESOLVER, IDEMPOTENCY_STORE, IDEMPOTENCY_STORE_OPTIONS, SQL_EXECUTOR } from './tokens';

export interface IdempotencyModuleConfig {
  /** The injection token the consuming app already provides its Drizzle db under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** See IdempotencyStoreOptions — no safe default, must be set from real endpoint latency data. */
  staleAfterSeconds: number;

  /**
   * The consumer's own IdempotencyScopeResolver token, for an endpoint
   * reachable without an authenticated actor. Omit to use ActorScopeResolver
   * (the authenticated-only default) for every endpoint this interceptor is
   * applied to.
   */
  scopeResolverToken?: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Whatever module(s) export the providers behind sqlExecutorToken and
   * scopeResolverToken. useExisting only resolves a token NestJS can
   * already see in *this* module's own providers or imports — not anywhere
   * in the wider application graph.
   */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — requires config because there's no default for which
 * provider is the consumer's db client, and no safe default staleness
 * window (see IdempotencyStoreOptions). Does not apply IdempotencyInterceptor
 * to anything itself — it's provided and exported so the consumer decides
 * per-endpoint via @UseInterceptors(IdempotencyInterceptor), matching
 * AuthorizationModule's treatment of AuthorizationGuard.
 */
@Module({})
export class IdempotencyModule {
  static forRoot(config: IdempotencyModuleConfig): DynamicModule {
    const scopeResolverProvider: Provider = config.scopeResolverToken
      ? { provide: IDEMPOTENCY_SCOPE_RESOLVER, useExisting: config.scopeResolverToken }
      : { provide: IDEMPOTENCY_SCOPE_RESOLVER, useClass: ActorScopeResolver };

    return {
      module: IdempotencyModule,
      imports: config.imports ?? [],
      providers: [
        { provide: SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: IDEMPOTENCY_STORE_OPTIONS, useValue: { staleAfterSeconds: config.staleAfterSeconds } },
        PostgresIdempotencyStore,
        { provide: IDEMPOTENCY_STORE, useExisting: PostgresIdempotencyStore },
        scopeResolverProvider,
        IdempotencyInterceptor,
      ],
      exports: [IDEMPOTENCY_STORE, IdempotencyInterceptor],
    };
  }
}
