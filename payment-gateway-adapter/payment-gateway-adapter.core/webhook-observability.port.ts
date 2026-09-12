import type { PaymentGatewayStatus } from './payment-gateway-adapter.port';

/** One `commons_payment_gateway_webhook_event` row, mapped and typed. */
export interface WebhookEventRecord {
  id: string;
  gateway: string;
  gatewayReference: string | null;
  status: PaymentGatewayStatus | null;
  /** `'applied'` — a new transition was processed. `'duplicate'` — a redelivery, no-op'd. `'ignored_backwards'` — an out-of-order event, would have regressed status. `'signature_invalid'` — verification failed, never processed. */
  outcome: 'applied' | 'duplicate' | 'ignored_backwards' | 'signature_invalid';
  occurredAt: Date;
  correlationId: string | null;
}

export interface WebhookEventQuery {
  gateway?: string;
  outcome?: WebhookEventRecord['outcome'];
  correlationId?: string;
  /** Inclusive lower bound on `occurredAt`. */
  since?: Date;
  /** Exclusive upper bound on `occurredAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface WebhookEventPage {
  /** Newest first. */
  events: WebhookEventRecord[];
  /** Present only when more rows match — pass back as `WebhookEventQuery.cursor`. */
  nextCursor?: string;
}

/** One row of the "is this webhook path healthy" dashboard. */
export interface WebhookOutcomeCount {
  outcome: WebhookEventRecord['outcome'];
  count: number;
}

/**
 * Read-only reporting over the webhook event log for an ops/security screen
 * — the most security-critical path in a payments system deserves more than
 * silence. Bound under `WEBHOOK_OBSERVABILITY_PORT` by a stack adapter;
 * consumed by `payment-gateway-adapter.api`. Never mutates.
 */
export interface WebhookObservabilityPort {
  /** Webhook events, newest first, keyset-paginated. */
  listEvents(query?: WebhookEventQuery): Promise<WebhookEventPage>;
  /** Counts by outcome within an optional window — a spike in `signature_invalid` or `ignored_backwards` is worth investigating, not silently absorbed. */
  outcomeCounts(since?: Date): Promise<WebhookOutcomeCount[]>;
}
