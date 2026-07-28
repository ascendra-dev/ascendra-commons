/**
 * Injection tokens for the interfaces a consuming project must bind to a real
 * implementation. Symbols, not string literals — the same reasoning
 * authorization-model-pattern.md uses for its AUTHORIZER token, so a typo in a
 * binding is a compile error, not a silently unbound provider.
 */

/** Resolves a 'user' recipient's contact info — consumer's own user/issuer/staff table. */
export const USER_CONTACT_RESOLVER = Symbol('USER_CONTACT_RESOLVER');

/** The real email provider, once EmailChannelTransport is bound instead of LogChannelTransport. */
export const EMAIL_CLIENT = Symbol('EMAIL_CLIENT');

/** Backs LogChannelTransport — shared across every channel currently stubbed as a log. */
export const NOTIFICATION_LOG_STORE = Symbol('NOTIFICATION_LOG_STORE');

/**
 * Each channel maintains its own set of templates — separate tokens, even
 * though they currently share the same NotificationTemplateRepository shape.
 * A future WhatsApp provider's real template model (pre-approved names,
 * structured params) will likely need its own shape and its own token; this
 * one is a placeholder using the generic shape until that's decided.
 */
export const EMAIL_TEMPLATE_REPOSITORY = Symbol('EMAIL_TEMPLATE_REPOSITORY');
export const WHATSAPP_TEMPLATE_REPOSITORY = Symbol('WHATSAPP_TEMPLATE_REPOSITORY');
export const SMS_TEMPLATE_REPOSITORY = Symbol('SMS_TEMPLATE_REPOSITORY');

/** The event-type -> channel(s) decision. Data, not code — see StaticNotifierChannelPolicy. */
export const NOTIFIER_CHANNEL_POLICY = Symbol('NOTIFIER_CHANNEL_POLICY');
/** The raw config object StaticNotifierChannelPolicy reads — consumer-owned. */
export const NOTIFIER_CHANNEL_CONFIG = Symbol('NOTIFIER_CHANNEL_CONFIG');
/** A Map<NotificationChannel, Notifier> — which configured ChannelNotifier backs each channel name. */
export const NOTIFIER_CHANNELS = Symbol('NOTIFIER_CHANNELS');

/**
 * What feature/listener code actually injects. Notifier is a TypeScript
 * interface — it has no runtime representation, so nothing can be injected "as
 * Notifier" without a token. Bind this to whichever Notifier the app should use
 * app-wide (a single ChannelNotifier, or NotifierRouter for multi-channel);
 * every listener depends on this token, never on a concrete class.
 */
export const NOTIFIER = Symbol('NOTIFIER');
