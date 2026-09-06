/**
 * Injection tokens. Symbols, not string literals — the same reasoning
 * `authorization`'s `AUTHORIZER` token uses, so a typo in a binding is a
 * compile error, not a silently unbound provider. Each exists because the
 * thing it points at is a TypeScript interface (no runtime representation) or
 * a value Nest can't auto-construct.
 */

/**
 * What `Notifier` and the three senders depend on — bound to whichever
 * `NotificationConfig` the app uses (the built-in `StaticNotificationConfig`,
 * or a consumer's own via `configToken`).
 */
export const NOTIFICATION_CONFIG = Symbol('NOTIFICATION_CONFIG');

/**
 * Resolves a `'user'` recipient's contact info. Defaults to
 * `NullUserContactResolver` in `NotificationModule.forRoot()`; a consumer
 * overrides it via `userContactResolverToken` once they have a real user table.
 */
export const USER_CONTACT_RESOLVER = Symbol('USER_CONTACT_RESOLVER');

/** A `Map<NotificationChannel, NotificationSender>` — assembled by a factory, not a class Nest constructs directly. */
export const NOTIFICATION_CHANNEL_SENDERS = Symbol('NOTIFICATION_CHANNEL_SENDERS');

/** What feature/listener code injects — `Notifier` is a class, but call sites depend on this token so the strategy can be swapped without touching them. */
export const NOTIFIER = Symbol('NOTIFIER');
