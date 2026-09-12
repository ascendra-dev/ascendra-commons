import { bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_payment_gateway_webhook_event` table — one row per
 * webhook attempt, *regardless of outcome* (`applied` / `duplicate` /
 * `ignored_backwards` / `signature_invalid`), written by
 * `PostgresWebhookEventLog`. The security/ops analog of
 * `commons_domain_events_delivery`: "did this webhook path behave" for the
 * most security-critical path in a payments system.
 */
export const webhookEventTable = pgTable(
  'commons_payment_gateway_webhook_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    gateway: text('gateway').notNull(),
    /** Nullable — a `signature_invalid` event may arrive before any reference could be trusted. */
    gatewayReference: text('gateway_reference'),
    /** Nullable — same reasoning as `gatewayReference`. */
    status: text('status'),
    outcome: text('outcome').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** "recent webhook activity" — the default admin-screen query. */
    index('commons_payment_gateway_webhook_event_time_idx').on(t.application, t.occurredAt),
    /** `outcomeCounts()`'s own aggregate — a spike in `signature_invalid`/`ignored_backwards` is worth investigating. */
    index('commons_payment_gateway_webhook_event_outcome_idx').on(t.application, t.outcome, t.occurredAt),
    /** "everything for this one payment" — a support lookup by reference. */
    index('commons_payment_gateway_webhook_event_reference_idx').on(t.gateway, t.gatewayReference),
  ],
);
