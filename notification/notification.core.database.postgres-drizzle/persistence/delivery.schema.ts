import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { DeliveryContent } from '../../notification.core';

/**
 * The reference `commons_notification_delivery` table — one row per channel
 * send attempt, written by `Notifier` through `PostgresNotificationDeliveryRecorder`.
 * The notification analog of `commons_jobs_job_run`: "did the reminder actually
 * go out, and to whom" for a support/ops screen.
 *
 * `recipient_ref` is **redacted** — `user:<id>` for a known user, or just
 * `raw:email` / `raw:phone` / `raw` for a raw recipient. Never an address, so
 * the table isn't a PII store.
 *
 * `status` is `sent` / `failed` at send time; a later provider webhook can move
 * it to `delivered` / `bounced` via `updateDeliveryStatus`, matched on
 * `provider_message_id`.
 *
 * Source of truth for the columns; `notification-delivery.migration.sql` is the
 * hand-kept DDL — keep the two, plus the INSERT in
 * `postgres-notification-delivery-recorder.ts`, in sync.
 */
export const notificationDelivery = pgTable(
  'commons_notification_delivery',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    notificationType: text('notification_type').notNull(),
    channel: text('channel').notNull(),
    tenantId: text('tenant_id'),
    recipientRef: text('recipient_ref').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    providerMessageId: text('provider_message_id'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Nullable — the caller's `NotificationRequest.correlationId`, when set, for a cross-module trace. */
    correlationId: text('correlation_id'),
    /**
     * Nullable — the rendered message + variables, written **only** when the
     * recorder is configured `storeContent: true`. Full-fidelity, PII-bearing;
     * pruned with the row. The "light" message archive (rollout item 6).
     */
    content: jsonb('content').$type<DeliveryContent>(),
  },
  (t) => ({
    byTypeTime: index('commons_notification_delivery_type_time_idx').on(t.application, t.notificationType, t.attemptedAt),
    byRecipient: index('commons_notification_delivery_recipient_idx').on(t.application, t.recipientRef, t.attemptedAt),
    byProviderMsg: index('commons_notification_delivery_provider_msg_idx').on(t.providerMessageId),
  }),
);
