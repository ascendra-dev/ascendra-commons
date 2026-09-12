import { bigserial, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_domain_events_delivery` table — one row per
 * `emit()`/`emitCritical()` call, written by `InProcessDomainEventEmitter`
 * through `PostgresEventDeliveryRecorder`. **Delivery only** — whether a
 * listener was subscribed and the hand-off happened — never a listener's own
 * outcome; see `domain-events.core`'s README, "What this does and doesn't
 * observe."
 *
 * Source of truth for the columns; `domain-event-delivery.migration.sql` is
 * the hand-kept DDL — keep the two, plus the INSERT in
 * `postgres-event-delivery-recorder.ts`, in sync.
 */
export const domainEventDeliveryTable = pgTable(
  'commons_domain_events_delivery',
  {
    /** Assigned by Postgres on insert — an append-only ordered log, never looked up by id from outside. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    eventName: text('event_name').notNull(),
    /** `'emit' | 'emitCritical'`. */
    method: text('method').notNull(),
    /** `'in-process'` today — free once a broker transport records too. */
    transport: text('transport').notNull(),
    /** The business fact's own time (`event.occurredAt`), not when this row was written. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** `EventEmitter2.listenerCount(eventName)`, read before dispatch. */
    listenerCount: integer('listener_count').notNull(),
    /** `'delivered' | 'no_listeners' | 'dispatch_failed'` — see `EventDeliveryAttempt.status`. */
    status: text('status').notNull(),
    /** Nullable — set only for `dispatch_failed`. */
    reason: text('reason'),
    /** Nullable — the caller's correlation id, when threaded through `emit()`/`emitCritical()`, for a cross-module trace. */
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** "this event's history, recent first" — `DeliveryQuery` by `eventName`, and `deliveryCatalog()`'s per-event aggregation. */
    index('commons_domain_events_delivery_event_time_idx').on(t.application, t.eventName, t.deliveredAt),
    /** "deliveries that need attention" — `DeliveryQuery` by `status`. */
    index('commons_domain_events_delivery_status_idx').on(t.application, t.status, t.deliveredAt),
  ],
);
