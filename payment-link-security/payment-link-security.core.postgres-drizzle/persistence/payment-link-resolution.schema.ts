import { bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_payment_link_resolution` table — one row per
 * `resolve()` call, written by `PostgresTokenResolutionRecorder`. Never the
 * raw token (`token_hash` only — see `hash-token.ts`). The security/ops
 * analog of `commons_domain_events_delivery`: "did someone probe this
 * endpoint, and how" for an abuse-detection screen.
 */
export const paymentLinkResolutionTable = pgTable(
  'commons_payment_link_resolution',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    tokenHash: text('token_hash').notNull(),
    /** `'resolved' | 'not_found' | 'revoked'`. */
    outcome: text('outcome').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Nullable — the caller's correlation id, when threaded through `resolve()`, for a cross-module trace. */
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** "recent attempts, and how many failed" — the default admin-screen query. */
    index('commons_payment_link_resolution_time_idx').on(t.application, t.attemptedAt),
    /** "how many times has this exact (often revoked/expired) link been retried" — an abuse-pattern lookup. */
    index('commons_payment_link_resolution_token_hash_idx').on(t.tokenHash),
    /** `outcomeCounts()`'s own aggregate. */
    index('commons_payment_link_resolution_outcome_idx').on(t.application, t.outcome, t.attemptedAt),
  ],
);
