import type { CachedResponse } from './cached-response.interface';
import type { ClaimResult } from './claim-result';

/**
 * An atomic claim, not check-then-act — a plain `get()` then `save()` is not
 * safe even against one shared table: two requests carrying the same key
 * arriving close together can both see "nothing cached yet" before either has
 * written its own entry. The claim itself must be atomic at the store level.
 *
 * `.core` ships no implementation — wire `POSTGRES_IDEMPOTENCY_STORE`
 * (`idempotency-key.core.postgres-drizzle`, Model 1) or your own.
 * `idempotency-key.core.redis` is the placeholder for Model 2 (throws until
 * built).
 *
 * `complete()` takes the `claimId` from the `'claimed'` result — an evicted
 * (reclaimed-as-stale) claimer's `complete()` then no-ops instead of
 * overwriting the current owner's cached response.
 */
export interface IdempotencyStore {
  claim(key: string, scope: string): Promise<ClaimResult>;
  complete(key: string, scope: string, claimId: string, response: CachedResponse): Promise<void>;
}
