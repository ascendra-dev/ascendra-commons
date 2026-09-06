/** Injection token for Model 2 (Redis-backed store). Symbol, not a string literal. */

/**
 * What `RedisIdempotencyStoreModule` exports as its `IdempotencyStore`
 * implementation. Pass it to `IdempotencyModule.forRoot({ storeToken: REDIS_IDEMPOTENCY_STORE })`.
 * Wires, but every call throws `RedisIdempotencyStoreNotImplementedError` until
 * a real implementation is built.
 */
export const REDIS_IDEMPOTENCY_STORE = Symbol('REDIS_IDEMPOTENCY_STORE');
