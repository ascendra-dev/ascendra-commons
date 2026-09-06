/**
 * Injection tokens for the notification delivery-log + admin adapter. Separate
 * from `tokens.ts` (the config *reader*) so each `forRoot` is self-contained.
 */

/** The consumer's Drizzle db for the delivery log + admin reads/writes — a normal pooled connection. */
export const NOTIFICATION_ADMIN_SQL_EXECUTOR = Symbol('NOTIFICATION_ADMIN_SQL_EXECUTOR');

/** Which Ascendra application this process is — stamped on `commons_notification_delivery` rows, filtered on every read/write. */
export const NOTIFICATION_ADMIN_APPLICATION_ID = Symbol('NOTIFICATION_ADMIN_APPLICATION_ID');

/** What `PostgresNotificationDeliveryRecorderModule` exports — pass as `NotificationModule.forRoot({ deliveryRecorderToken })`. */
export const POSTGRES_NOTIFICATION_DELIVERY_RECORDER = Symbol('POSTGRES_NOTIFICATION_DELIVERY_RECORDER');

/** `PostgresNotificationObservabilityService` — delivery history + config-coverage gaps. */
export const POSTGRES_NOTIFICATION_OBSERVABILITY = Symbol('POSTGRES_NOTIFICATION_OBSERVABILITY');

/** `PostgresNotificationConfigAdminService` — CRUD on routes / templates / provider credentials. */
export const POSTGRES_NOTIFICATION_CONFIG_ADMIN = Symbol('POSTGRES_NOTIFICATION_CONFIG_ADMIN');
