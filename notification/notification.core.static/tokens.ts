/**
 * Injection tokens for Model 1 (static notification config). Symbols, not
 * string literals — a typo in a binding is a compile error.
 */

/** The `NotificationConfigData` `StaticNotificationConfig` reads. Consumer-supplied via `StaticNotificationConfigModule.forRoot()`. */
export const STATIC_NOTIFICATION_CONFIG_DATA = Symbol('STATIC_NOTIFICATION_CONFIG_DATA');

/**
 * What `StaticNotificationConfigModule` exports as its `NotificationConfig`
 * implementation. Pass it to
 * `NotificationModule.forRoot({ configToken: STATIC_NOTIFICATION_CONFIG })`.
 */
export const STATIC_NOTIFICATION_CONFIG = Symbol('STATIC_NOTIFICATION_CONFIG');
