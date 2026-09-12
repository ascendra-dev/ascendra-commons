import { DynamicModule, Module } from '@nestjs/common';
import { PostgresIdempotencyStore } from './postgres-idempotency-store';
import { IDEMPOTENCY_SQL_EXECUTOR, IDEMPOTENCY_STORE_OPTIONS, POSTGRES_IDEMPOTENCY_STORE } from './tokens';

export interface PostgresIdempotencyStoreModuleConfig {
  /** The injection token the consuming app already provides its Drizzle db under. Aliased via `useExisting`. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /**
   * How long a `'pending'` claim sits before a later request may reclaim it as
   * abandoned. **No safe universal default** — it must exceed the realistic
   * worst-case latency (including an external API call) of every endpoint the
   * interceptor is applied to. Too low → a still-in-flight request gets
   * reclaimed and re-run concurrently with itself. Measure the slowest enforced
   * endpoint's real p99; never copy a value from another project.
   * `forRoot()` throws unless it's `> 0`.
   */
  staleAfterSeconds: number;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Wires `PostgresIdempotencyStore` and exports it under `POSTGRES_IDEMPOTENCY_STORE`.
 *
 * ```typescript
 * IdempotencyModule.forRoot({
 *   storeToken: POSTGRES_IDEMPOTENCY_STORE,
 *   imports: [
 *     PostgresIdempotencyStoreModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION,
 *       staleAfterSeconds: 45,
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 */
@Module({})
export class PostgresIdempotencyStoreModule {
  static forRoot(config: PostgresIdempotencyStoreModuleConfig): DynamicModule {
    if (!(typeof config?.staleAfterSeconds === 'number') || !(config.staleAfterSeconds > 0) || !Number.isFinite(config.staleAfterSeconds)) {
      throw new Error(
        `PostgresIdempotencyStoreModule.forRoot: staleAfterSeconds must be a finite number > 0 ` +
          `(got ${String(config?.staleAfterSeconds)}). A value of 0 makes every pending claim instantly ` +
          `reclaimable, silently defeating the pattern. Measure this project's slowest enforced endpoint's p99.`,
      );
    }
    return {
      module: PostgresIdempotencyStoreModule,
      imports: config.imports ?? [],
      providers: [
        { provide: IDEMPOTENCY_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: IDEMPOTENCY_STORE_OPTIONS, useValue: { staleAfterSeconds: config.staleAfterSeconds } },
        PostgresIdempotencyStore,
        { provide: POSTGRES_IDEMPOTENCY_STORE, useExisting: PostgresIdempotencyStore },
      ],
      exports: [POSTGRES_IDEMPOTENCY_STORE],
    };
  }
}
