import type { TokenResolutionAttempt } from './token-resolution-recorder.port';

/** One `commons_payment_link_resolution` row, mapped and typed. */
export interface TokenResolutionRecord {
  id: string;
  /** A one-way hash of the attempted token — never the raw value. Repeated attempts sharing one hash means one specific (often revoked/expired) link is being retried; many distinct hashes means broader enumeration. */
  tokenHash: string;
  outcome: TokenResolutionAttempt['outcome'];
  attemptedAt: Date;
  correlationId: string | null;
}

export interface ResolutionQuery {
  outcome?: TokenResolutionAttempt['outcome'];
  correlationId?: string;
  /** Inclusive lower bound on `attemptedAt`. */
  since?: Date;
  /** Exclusive upper bound on `attemptedAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface ResolutionPage {
  /** Newest first. */
  attempts: TokenResolutionRecord[];
  /** Present only when more rows match — pass back as `ResolutionQuery.cursor`. */
  nextCursor?: string;
}

/** One row of the "is someone probing us" dashboard. */
export interface ResolutionOutcomeCount {
  outcome: TokenResolutionAttempt['outcome'];
  count: number;
}

/**
 * Read-only reporting over the resolution log for a security/ops screen.
 * Bound under `TOKEN_RESOLUTION_OBSERVABILITY_PORT` by a stack adapter;
 * consumed by `payment-link-security.api`. Never mutates.
 */
export interface TokenResolutionObservabilityPort {
  /** Resolution attempts, newest first, keyset-paginated. */
  listAttempts(query?: ResolutionQuery): Promise<ResolutionPage>;
  /** Counts by outcome within an optional window — a spike in `not_found` is the enumeration/brute-force signal. */
  outcomeCounts(since?: Date): Promise<ResolutionOutcomeCount[]>;
}
