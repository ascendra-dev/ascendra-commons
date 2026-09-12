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
 * overwriting the current owner's cached response. That no-op is itself worth
 * knowing about — see `idempotency-key.core.postgres-drizzle`'s
 * `PostgresIdempotencyStore` for how the reference adapter surfaces it.
 *
 * `correlationId` is optional on both methods — the ambient request/trace id,
 * when the caller has one (the same shape `JobTrigger.trigger()` and
 * `DomainEventEmitter.emit()` take), threaded through so a stack adapter can
 * join a claim to the same id in `commons_audit_event` /
 * `commons_notification_delivery` / `commons_domain_events_delivery` for a
 * cross-module trace. Plumbing only — never part of `scope` or the cache key.
 */
export interface IdempotencyStore {
  claim(key: string, scope: string, correlationId?: string): Promise<ClaimResult>;
  complete(key: string, scope: string, claimId: string, response: CachedResponse): Promise<void>;
}
