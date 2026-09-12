/** One `commons_rate_limit_rejection` row, mapped and typed. */
export interface RateLimitRejectionRecord {
  id: string;
  route: string;
  identifier: string;
  limit: number;
  ttlMs: number;
  rejectedAt: Date;
  correlationId: string | null;
}

export interface RejectionQuery {
  route?: string;
  identifier?: string;
  correlationId?: string;
  /** Inclusive lower bound on `rejectedAt`. */
  since?: Date;
  /** Exclusive upper bound on `rejectedAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface RejectionPage {
  /** Newest first. */
  rejections: RateLimitRejectionRecord[];
  /** Present only when more rows match — pass back as `RejectionQuery.cursor`. */
  nextCursor?: string;
}

/** One row of the "who's hitting our limits" dashboard. */
export interface RouteRejectionCount {
  route: string;
  count: number;
}

/**
 * Read-only reporting over the rejection log for a security/ops screen.
 * Bound under `RATE_LIMIT_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `rate-limiting.api`. Never mutates.
 */
export interface RateLimitObservabilityPort {
  /** Rejections, newest first, keyset-paginated. */
  listRejections(query?: RejectionQuery): Promise<RejectionPage>;
  /** Counts per route within an optional window — a spike on one route (e.g. `pay/:token`) is the "being hammered" signal. */
  rejectionCatalog(since?: Date): Promise<RouteRejectionCount[]>;
}
