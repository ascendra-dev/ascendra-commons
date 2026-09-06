import { boolean, index, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';

/**
 * The reference `notification_*` schema — one concrete Postgres/Drizzle shape
 * of the `NotificationConfig` interface (Model 2). Source of truth for the
 * columns; `notification-config.migration.sql` in this folder is the hand-kept
 * DDL form — keep the two in sync.
 *
 * Three tables, one per `NotificationConfig` method. Re-export from your own
 * schema barrel for `drizzle-kit`, or paste the migration. Requires
 * PostgreSQL 15+ (NULLS NOT DISTINCT).
 */

/**
 * Which channel(s) a notificationType uses. `tenant_id` NULL = the deployment
 * default; a tenant-specific row (if present) wins over it.
 */
export const notificationChannelRoute = pgTable(
  'notification_channel_route',
  {
    notificationType: text('notification_type').notNull(),
    tenantId: text('tenant_id'),
    channels: text('channels').array().notNull(),
  },
  (t) => ({
    uq: unique('notification_channel_route_uq').on(t.notificationType, t.tenantId).nullsNotDistinct(),
  }),
);

/**
 * Template text for one channel + notificationType. `tenant_id` NULL = the
 * deployment default; a tenant-specific row wins. `subject`/`is_html` are
 * email-only — SMS rows leave `subject` null.
 */
export const notificationTemplate = pgTable(
  'notification_template',
  {
    channel: text('channel').notNull(),
    notificationType: text('notification_type').notNull(),
    tenantId: text('tenant_id'),
    subject: text('subject'),
    body: text('body').notNull(),
    isHtml: boolean('is_html').notNull().default(false),
  },
  (t) => ({
    uq: unique('notification_template_uq').on(t.channel, t.notificationType, t.tenantId).nullsNotDistinct(),
  }),
);

/**
 * Per-tenant delivery-provider credentials for one channel. `tenant_id` is
 * NOT NULL — credentials never fall through to a default (a missing row is a
 * `no_provider_config` failure, not "use another tenant's account").
 *
 * `api_key` is a live secret. Encrypt it at rest — Supabase Vault, `pgcrypto`,
 * or a decrypting view — or store a secret-manager reference and resolve it in
 * a `PostgresNotificationConfig` subclass. The adapter reads the column as-is.
 */
export const notificationProviderCredential = pgTable(
  'notification_provider_credential',
  {
    channel: text('channel').notNull(),
    tenantId: text('tenant_id').notNull(),
    apiKey: text('api_key').notNull(),
    from: text('from').notNull(),
    fromName: text('from_name'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.channel, t.tenantId] }),
    byTenant: index('notification_provider_credential_tenant').on(t.tenantId),
  }),
);
