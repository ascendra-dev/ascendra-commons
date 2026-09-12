import { Injectable } from '@nestjs/common';
import type { ClaimResult, IdempotencyStore } from '../idempotency-key.core';

/** Thrown by every `RedisIdempotencyStore` method until a real implementation is built. */
export class RedisIdempotencyStoreNotImplementedError extends Error {
  constructor() {
    super(
      'RedisIdempotencyStore is not implemented. Use POSTGRES_IDEMPOTENCY_STORE ' +
        '(idempotency-key.core.postgres-drizzle, Model 1), or implement this class — see this ' +
        "package's README for the Redis design.",
    );
    this.name = 'RedisIdempotencyStoreNotImplementedError';
  }
}

/**
 * Model 2 — a deliberate placeholder. The `IdempotencyStore` port, the
 * `REDIS_IDEMPOTENCY_STORE` token, and `IdempotencyModule.forRoot({ storeToken })`
 * all exist so adopting a Redis-backed store later is a wiring change, not a
 * refactor of every enforced endpoint. This class is the one piece genuinely
 * not done — shipping it as a loud stub is the honest state.
 *
 * See the README for the design a real implementation resolves first (SET NX PX
 * for the atomic claim; mapping `staleAfterSeconds` onto the pending key's TTL;
 * a short second TTL on the completed response; and the `claimId` guard, which
 * a Redis Lua script would check the same way `PostgresIdempotencyStore`'s
 * `WHERE claim_id = $` does).
 */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  async claim(_key: string, _scope: string): Promise<ClaimResult> {
    throw new RedisIdempotencyStoreNotImplementedError();
  }

  async complete(_key: string, _scope: string, _claimId: string): Promise<void> {
    throw new RedisIdempotencyStoreNotImplementedError();
  }
}
