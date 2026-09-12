import type { EventDeliveryAttempt } from './event-delivery-recorder.port';

/** One `commons_domain_events_delivery` row, mapped and typed — what a delivery-log UI table renders. */
export interface EventDeliveryRecord {
  /** The `bigserial` id as a string (Postgres returns bigint as text to avoid precision loss). */
  id: string;
  eventName: string;
  method: EventDeliveryAttempt['method'];
  transport: string;
  occurredAt: Date;
  deliveredAt: Date;
  listenerCount: number;
  status: EventDeliveryAttempt['status'];
  reason: string | null;
  correlationId: string | null;
}

export interface DeliveryQuery {
  eventName?: string;
  method?: EventDeliveryAttempt['method'];
  status?: EventDeliveryAttempt['status'];
  /** Join a delivery to the same id in audit / notification-delivery / job-run for a cross-module trace. */
  correlationId?: string;
  /** Inclusive lower bound on `deliveredAt`. */
  since?: Date;
  /** Exclusive upper bound on `deliveredAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface DeliveryPage {
  /** Newest first. */
  deliveries: EventDeliveryRecord[];
  /** Present only when more rows match — pass back as `DeliveryQuery.cursor`. */
  nextCursor?: string;
}

/** One row of the "what events actually fire" dashboard — aggregated from the delivery log, not the (separate) listener catalogue. */
export interface EventDeliveryCatalogEntry {
  eventName: string;
  totalDeliveries: number;
  /** Times this event fired with zero listeners subscribed — a wiring gap, not a listener failure. */
  noListenerCount: number;
  /** Times the transport itself failed to dispatch — rare; see `EventDeliveryAttempt.status`. */
  dispatchFailedCount: number;
  lastDeliveredAt: Date;
}

/**
 * Read-only reporting over the delivery log for an admin screen. Bound under
 * `EVENT_DELIVERY_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `domain-events.api`. Never mutates — deliveries are write-once, like
 * `audit-logging`'s records.
 */
export interface EventDeliveryObservabilityPort {
  /** Delivery attempts, newest first, keyset-paginated. */
  listDeliveries(query?: DeliveryQuery): Promise<DeliveryPage>;
  /** One row per event name that has ever fired — "what events exist and how have they behaved." */
  deliveryCatalog(): Promise<EventDeliveryCatalogEntry[]>;
}
