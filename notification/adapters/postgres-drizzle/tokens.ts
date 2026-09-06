/**
 * Injection tokens for the Postgres/Drizzle notification-config adapter.
 * Symbols, not string literals — a typo in a binding is a compile error.
 */

/** Bound to the consumer's Drizzle db via `PostgresNotificationConfigModule.forRoot({ sqlExecutorToken })`. */
export const NOTIFICATION_CONFIG_SQL_EXECUTOR = Symbol('NOTIFICATION_CONFIG_SQL_EXECUTOR');

/** `{ cacheTtlSeconds, application }` from `PostgresNotificationConfigModule.forRoot()`. */
export const NOTIFICATION_CONFIG_OPTIONS = Symbol('NOTIFICATION_CONFIG_OPTIONS');

/**
 * What `PostgresNotificationConfigModule` exports as the `NotificationConfig`
 * implementation — pass this as
 * `NotificationModule.forRoot({ model: 'database', configToken })`.
 */
export const POSTGRES_NOTIFICATION_CONFIG = Symbol('POSTGRES_NOTIFICATION_CONFIG');
