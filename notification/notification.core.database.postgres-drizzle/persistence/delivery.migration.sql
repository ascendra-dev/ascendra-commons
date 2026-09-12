-- Reference migration for the notification pattern's delivery log
-- (PostgresNotificationDeliveryRecorder + PostgresNotificationObservabilityService).
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7). Copy this into the consuming project's own
-- migration tooling, or re-export `notificationDelivery` from
-- `notification-delivery.schema.ts` and let `drizzle-kit generate` produce it.
--
-- Keep in sync with `notification-delivery.schema.ts` and the INSERT in
-- `postgres-notification-delivery-recorder.ts`.
--
-- `recipient_ref` is redacted (`user:<id>` / `raw:email` / `raw:phone` / `raw`) —
-- never an address. `status` is 'sent' / 'failed' at send time; a provider
-- webhook may later move it to 'delivered' / 'bounced'. `application` scopes
-- every read.

CREATE TABLE IF NOT EXISTS "commons_notification_delivery" (
  "id"                  bigserial   PRIMARY KEY,
  "application"         text        NOT NULL,
  "notification_type"   text        NOT NULL,
  "channel"             text        NOT NULL,
  "tenant_id"           text,
  "recipient_ref"       text        NOT NULL,
  "status"              text        NOT NULL,
  "reason"              text,
  "provider_message_id" text,
  "attempted_at"        timestamptz NOT NULL,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "correlation_id"      text,
  -- rendered message + variables; written only when the recorder is `storeContent: true`. PII-bearing.
  "content"             jsonb
);

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_type_time_idx"
  ON "commons_notification_delivery" ("application", "notification_type", "attempted_at");

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_recipient_idx"
  ON "commons_notification_delivery" ("application", "recipient_ref", "attempted_at");

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_provider_msg_idx"
  ON "commons_notification_delivery" ("provider_message_id");
