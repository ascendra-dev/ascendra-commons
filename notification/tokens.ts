/**
 * Injection tokens for the interfaces a consuming project must bind to a real
 * implementation. Symbols, not string literals — the same reasoning
 * authorization-model-pattern.md uses for its AUTHORIZER token, so a typo in a
 * binding is a compile error, not a silently unbound provider.
 */
export const NOTIFICATION_TEMPLATE_REPOSITORY = Symbol('NOTIFICATION_TEMPLATE_REPOSITORY');
export const NOTIFICATION_LOG_STORE = Symbol('NOTIFICATION_LOG_STORE');
export const EMAIL_CLIENT = Symbol('EMAIL_CLIENT');
export const USER_CONTACT_RESOLVER = Symbol('USER_CONTACT_RESOLVER');

/**
 * What feature/listener code actually injects. NotificationSender is a TypeScript
 * interface — it has no runtime representation, so nothing can be injected "as
 * NotificationSender" without a token to bind it to. Bind this to whichever
 * concrete sender the app should use app-wide; every listener depends on this
 * token, never on a concrete class, so switching senders is a one-line change
 * to this binding alone.
 */
export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

/** The event-type -> channel(s) decision. Data, not code — see StaticNotificationChannelPolicy. */
export const NOTIFICATION_CHANNEL_POLICY = Symbol('NOTIFICATION_CHANNEL_POLICY');
/** The raw config object StaticNotificationChannelPolicy reads — consumer-owned, e.g. { 'invoice.sent': ['email'] }. */
export const NOTIFICATION_CHANNEL_CONFIG = Symbol('NOTIFICATION_CHANNEL_CONFIG');
/** A Map<NotificationChannel, NotificationSender> — which concrete sender backs each channel, consumer-assembled. */
export const NOTIFICATION_CHANNEL_SENDERS = Symbol('NOTIFICATION_CHANNEL_SENDERS');
