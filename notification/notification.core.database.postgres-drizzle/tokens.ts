/**
 * Injection tokens for the Postgres/Drizzle notification adapter. Symbols, not
 * string literals.
 *
 * The family tokens (`NOTIFICATION_OBSERVABILITY_PORT`,
 * `NOTIFICATION_CONFIG_ADMIN_PORT`) come from `notification.core.database`; the
 * config token `POSTGRES_NOTIFICATION_CONFIG` and delivery-recorder token
 * `POSTGRES_NOTIFICATION_DELIVERY_RECORDER` are passed to
 * `NotificationModule.forRoot({ configToken, deliveryRecorderToken })`.
 */

// --- config reader ---
export const NOTIFICATION_CONFIG_SQL_EXECUTOR = Symbol('NOTIFICATION_CONFIG_SQL_EXECUTOR');
export const NOTIFICATION_CONFIG_OPTIONS = Symbol('NOTIFICATION_CONFIG_OPTIONS');
export const POSTGRES_NOTIFICATION_CONFIG = Symbol('POSTGRES_NOTIFICATION_CONFIG');

// --- delivery log + admin (shared db + application) ---
export const NOTIFICATION_ADMIN_SQL_EXECUTOR = Symbol('NOTIFICATION_ADMIN_SQL_EXECUTOR');
export const NOTIFICATION_ADMIN_APPLICATION_ID = Symbol('NOTIFICATION_ADMIN_APPLICATION_ID');
export const NOTIFICATION_ADMIN_STORE_CONTENT = Symbol('NOTIFICATION_ADMIN_STORE_CONTENT');
export const POSTGRES_NOTIFICATION_DELIVERY_RECORDER = Symbol('POSTGRES_NOTIFICATION_DELIVERY_RECORDER');
