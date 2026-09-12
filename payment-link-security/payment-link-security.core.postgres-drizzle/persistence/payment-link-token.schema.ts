import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_payment_link_token` table — one row per generated
 * link. **Stores a hash, never the raw token** (see `hash-token.ts`) — the
 * same posture a password gets, not a plaintext secret at rest. `resolve()`
 * hashes the incoming token and looks up by `token_hash`.
 *
 * Source of truth for the columns; `payment-link-token.migration.sql` is the
 * hand-kept DDL — keep the two, plus `postgres-payment-link-token-service.ts`,
 * in sync.
 */
export const paymentLinkTokenTable = pgTable(
  'commons_payment_link_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    application: text('application').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** Whatever the link ultimately grants access to — an invoice id, most concretely. Opaque to this module. */
    resourceId: text('resource_id').notNull(),
    /** Whose identity the token establishes — a payer id. Opaque to this module. */
    subjectId: text('subject_id').notNull(),
    /** Nullable — set when the underlying resource becomes non-payable (voided, fully paid). */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    /** `revoke(resourceId)`'s own `UPDATE … WHERE resource_id = $ AND revoked_at IS NULL`. */
    index('commons_payment_link_token_resource_idx').on(t.application, t.resourceId),
  ],
);
