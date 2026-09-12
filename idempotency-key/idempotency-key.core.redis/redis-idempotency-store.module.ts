import { DynamicModule, Module } from '@nestjs/common';
import { RedisIdempotencyStore } from './redis-idempotency-store';
import { REDIS_IDEMPOTENCY_STORE } from './tokens';

/**
 * Model 2 wiring — a deliberate placeholder. Provides `RedisIdempotencyStore`
 * (which throws `RedisIdempotencyStoreNotImplementedError` on every call) under
 * `REDIS_IDEMPOTENCY_STORE`.
 *
 * ```typescript
 * IdempotencyModule.forRoot({
 *   storeToken: REDIS_IDEMPOTENCY_STORE,
 *   imports: [RedisIdempotencyStoreModule.forRoot()],
 * })
 * ```
 *
 * `forRoot()` takes no config yet — a real implementation would take a Redis
 * client token and `staleAfterSeconds` (see the README). The seam is real so
 * that's a non-breaking addition when it lands.
 */
@Module({})
export class RedisIdempotencyStoreModule {
  static forRoot(): DynamicModule {
    return {
      module: RedisIdempotencyStoreModule,
      providers: [
        RedisIdempotencyStore,
        { provide: REDIS_IDEMPOTENCY_STORE, useExisting: RedisIdempotencyStore },
      ],
      exports: [REDIS_IDEMPOTENCY_STORE],
    };
  }
}
