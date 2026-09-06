import type { NotificationChannel } from './notification.types';

/**
 * One channel's send attempt, as `Notifier` observed it — one row in the
 * delivery log. `recipientRef` is deliberately *redacted*: `user:<id>` for a
 * known user, or just `raw:email` / `raw:phone` / `raw` for a raw recipient —
 * never the actual address, so the log isn't a PII store.
 */
export interface DeliveryAttempt {
  notificationType: string;
  channel: NotificationChannel;
  tenantId: string | null;
  recipientRef: string;
  status: 'sent' | 'failed';
  reason?: string;
  providerMessageId?: string;
  attemptedAt: Date;
  /** The ambient correlation id, when the consumer threads one in (see the delivery adapter). */
  correlationId?: string;
}

/** A later status change for a row, matched by `providerMessageId` — fed from a provider webhook. */
export interface DeliveryStatusUpdate {
  providerMessageId: string;
  status: 'delivered' | 'bounced' | 'failed';
  /** Bounce reason / provider detail. */
  detail?: string;
}

/**
 * The delivery-log port. `Notifier` calls `recordAttempts()` once per
 * `notify()` (one entry per channel). **Best-effort by contract: an
 * implementation must not throw** — a failure to log a delivery must never
 * change the notification's own outcome. `Notifier` also guards the call.
 *
 * `updateDeliveryStatus()` is the webhook side — the consumer's provider-webhook
 * controller calls it. A no-op recorder makes both inert; the Postgres adapter
 * implements them against `commons_notification_delivery`.
 */
export interface NotificationDeliveryRecorder {
  recordAttempts(attempts: DeliveryAttempt[]): Promise<void>;
  updateDeliveryStatus(update: DeliveryStatusUpdate): Promise<void>;
}
