import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The atomic dedup ledger — one row per `(application, gateway, gateway_reference, status)`
 * ever successfully claimed. `WebhookEventLog.claim()` is a single
 * `INSERT … ON CONFLICT DO NOTHING RETURNING` against this table's composite
 * primary key — the same atomic-claim shape `idempotency-key`'s own store
 * uses, not a `has()` then `record()` check-then-act pair.
 *
 * No `id`/`created_at` beyond what's needed for the claim itself — the full
 * observability trail (including `duplicate`/`ignored_backwards`/
 * `signature_invalid` outcomes, which don't belong on *this* ledger) lives in
 * `commons_payment_gateway_webhook_event` instead.
 */
export const webhookClaimTable = pgTable(
  'commons_payment_gateway_webhook_claim',
  {
    application: text('application').notNull(),
    gateway: text('gateway').notNull(),
    gatewayReference: text('gateway_reference').notNull(),
    status: text('status').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.application, t.gateway, t.gatewayReference, t.status] })],
);
