import type { CachedResponse } from './cached-response.interface';

/**
 * `claimId` (on the `'claimed'` result) is the attempt's ownership token — the
 * interceptor threads it back into `store.complete()`, so a claim that was
 * later reclaimed as stale (its `claimId` overwritten by the new owner) can no
 * longer write its own response over the current owner's. See
 * `PostgresIdempotencyStore`.
 */
export type ClaimResult =
  | { status: 'claimed'; claimId: string } // this request is first — proceed, then complete() with claimId
  | { status: 'completed'; response: CachedResponse } // already finished — return the cached response
  | { status: 'in_progress' }; // a concurrent duplicate, still running elsewhere
