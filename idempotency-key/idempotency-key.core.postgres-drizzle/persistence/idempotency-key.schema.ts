import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_idempotency_key` table — source of truth for the
 * columns. `PostgresIdempotencyStore` writes exactly these; keep this,
 * `idempotency-key.migration.sql`, and the store's SQL in sync.
 *
 * A consuming project on Postgres/Drizzle re-exports this from its own schema
 * barrel for `drizzle-kit`, or copies the migration. A project on another stack
 * ignores this folder and provides its own `IdempotencyStore`.
 */
export const idempotencyKeyTable = pgTable(
  'commons_idempotency_key',
  {
    key: text('key').notNull(),
    /** The acting tenant/actor id — so one requester's key can't collide with another's. */
    scope: text('scope').notNull(),
    /** `'pending'` | `'completed'`. */
    status: text('status').notNull().default('pending'),
    /**
     * The current owner's attempt token — set on every claim and on a
     * stale-reclaim. `complete()` is guarded `WHERE claim_id = $x`, so a claim
     * that was reclaimed as stale can no longer write its response over the new
     * owner's.
     */
    claimId: uuid('claim_id').notNull(),
    /** Captured from the handler's real response, never hardcoded (201 for a POST-create, etc.). */
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.scope] }),
    /** The 24h cleanup `DELETE … WHERE created_at < now() - interval '24 hours'` scans on this. */
    byCreatedAt: index('commons_idempotency_key_created_at_idx').on(t.createdAt),
  }),
);
