/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error,
 * not a silently unbound provider.
 */

/** The consumer's Drizzle db client, aliased in via IdempotencyModule.forRoot() — this library never provides its own. */
export const SQL_EXECUTOR = Symbol('SQL_EXECUTOR');

/** IdempotencyStoreOptions data — see postgres-idempotency-store.ts. */
export const IDEMPOTENCY_STORE_OPTIONS = Symbol('IDEMPOTENCY_STORE_OPTIONS');

/** What feature code and IdempotencyInterceptor actually depend on — bound to whichever IdempotencyStore implementation the app uses. */
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/** Bound to ActorScopeResolver by default, or to the consumer's own resolver if supplied. */
export const IDEMPOTENCY_SCOPE_RESOLVER = Symbol('IDEMPOTENCY_SCOPE_RESOLVER');
