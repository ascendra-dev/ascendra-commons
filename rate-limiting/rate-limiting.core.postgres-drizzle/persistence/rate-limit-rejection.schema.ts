import { bigserial, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_rate_limit_rejection` table — one row per `429`,
 * written by `PostgresRateLimitEventRecorder`. The security/ops analog of
 * `commons_domain_events_delivery`: "is this endpoint being hammered" for an
 * abuse-detection screen.
 */
export const rateLimitRejectionTable = pgTable(
  'commons_rate_limit_rejection',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    /** The route *pattern* (e.g. `/pay/:token`), never the resolved URL with real ids in it. */
    route: text('route').notNull(),
    /** Whatever the throttler resolved as the requester's identity — an IP, most commonly. */
    identifier: text('identifier').notNull(),
    limit: integer('limit').notNull(),
    ttlMs: integer('ttl_ms').notNull(),
    rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Nullable — the caller's correlation id, when present on the request, for a cross-module trace. */
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** "recent rejections" — the default admin-screen query. */
    index('commons_rate_limit_rejection_time_idx').on(t.application, t.rejectedAt),
    /** `rejectionCatalog()`'s own per-route aggregate — "is this specific endpoint being hammered." */
    index('commons_rate_limit_rejection_route_idx').on(t.application, t.route, t.rejectedAt),
    /** "who's hitting our limits" — a lookup by identifier across routes. */
    index('commons_rate_limit_rejection_identifier_idx').on(t.identifier, t.rejectedAt),
  ],
);
