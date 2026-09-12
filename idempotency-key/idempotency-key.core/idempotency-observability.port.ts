import type { CachedResponse } from './cached-response.interface';

/** One `commons_idempotency_key` row, mapped and typed — what a support/ops screen renders. */
export interface IdempotencyClaimRecord {
  key: string;
  /** The acting tenant/actor id (or whatever the app's `IdempotencyScopeResolver` returns). */
  scope: string;
  status: 'pending' | 'completed';
  /** The cached response, once `status = 'completed'` — exactly what a legitimate retry would be replayed, nothing more exposed. */
  response: CachedResponse | null;
  createdAt: Date;
  /**
   * How many times a request for this `(key, scope)` was reclaimed as stale
   * (its owner presumed abandoned). Non-zero here doesn't by itself prove a
   * duplicate ran — the original owner may genuinely have finished or crashed
   * — but it's the number to look at when `staleAfterSeconds` is suspected of
   * being set too low.
   */
  reclaimCount: number;
  /**
   * How many `complete()` calls targeting this `(key, scope)` were dropped
   * because the claim they were completing had already been reclaimed by a
   * newer owner. **This one is unambiguous**: it means a request's result was
   * silently discarded because the safety window expired while it was still
   * in flight — the exact duplicate-processing failure mode
   * `staleAfterSeconds`'s doc comment describes.
   */
  lateCompleteNoOpCount: number;
  /** The caller's correlation id, when threaded through `claim()`, for a cross-module trace. */
  correlationId: string | null;
}

export interface ClaimQuery {
  status?: 'pending' | 'completed';
  scope?: string;
  correlationId?: string;
  /** Inclusive lower bound on `createdAt`. */
  since?: Date;
  /** Exclusive upper bound on `createdAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface ClaimPage {
  /** Newest first. */
  claims: IdempotencyClaimRecord[];
  /** Present only when more rows match — pass back as `ClaimQuery.cursor`. */
  nextCursor?: string;
}

/**
 * The health numbers for whatever window the store still retains (rows are
 * pruned — see the adapter README — so this is "recently," not "all time").
 */
export interface ClaimHealthSummary {
  pendingCount: number;
  completedCount: number;
  /** Claims with `reclaimCount > 0` — a possible-duplicate signal (see `IdempotencyClaimRecord.reclaimCount`). */
  reclaimedCount: number;
  /** Sum of every row's `lateCompleteNoOpCount` — an unambiguous duplicate-processing count. */
  lateCompleteNoOpTotal: number;
  totalCount: number;
  /** The oldest row currently retained — how far back this summary actually looks. */
  oldestRetainedAt: Date | null;
}

/**
 * Read-only reporting over the claim table for a support/ops screen. Bound
 * under `IDEMPOTENCY_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `idempotency-key.api`. Never mutates — claims are written only by
 * `IdempotencyStore`.
 */
export interface IdempotencyObservabilityPort {
  getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord | null>;
  /** Claims, newest first, keyset-paginated. */
  listClaims(query?: ClaimQuery): Promise<ClaimPage>;
  claimHealthSummary(): Promise<ClaimHealthSummary>;
}
