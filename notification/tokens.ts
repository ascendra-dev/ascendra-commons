/**
 * Injection tokens. Symbols, not string literals — the same reasoning
 * authorization-model-pattern.md uses for its AUTHORIZER token, so a typo in a
 * binding is a compile error, not a silently unbound provider. Every one of
 * these exists because the thing it points at is either a TypeScript interface
 * (no runtime representation — nothing can be "injected as" one without a
 * token) or a plain data value (not a class Nest can auto-construct).
 */

/** Resolves a 'user' recipient's contact info. Defaults to NullUserContactResolver (always no match) in NotificationModule.forRoot(); a consumer overrides this binding in their own module once they have a real user table to resolve against. */
export const USER_CONTACT_RESOLVER = Symbol('USER_CONTACT_RESOLVER');

/** The raw event-type -> channel(s) mapping StaticNotificationChannelConfig reads. Consumer-supplied via NotificationModule.forRoot(). */
export const NOTIFICATION_CHANNEL_CONFIG_DATA = Symbol('NOTIFICATION_CHANNEL_CONFIG_DATA');
/** What Notifier actually depends on — bound to whichever NotificationChannelConfig implementation the app uses. */
export const NOTIFICATION_CHANNEL_CONFIG = Symbol('NOTIFICATION_CHANNEL_CONFIG');

/** Email's own template data — separate from SMS's, since each channel maintains its own templates. */
export const EMAIL_TEMPLATE_DATA = Symbol('EMAIL_TEMPLATE_DATA');
export const EMAIL_TEMPLATE_REPOSITORY = Symbol('EMAIL_TEMPLATE_REPOSITORY');

export const SMS_TEMPLATE_DATA = Symbol('SMS_TEMPLATE_DATA');
export const SMS_TEMPLATE_REPOSITORY = Symbol('SMS_TEMPLATE_REPOSITORY');

/** Email's own provider credentials, by tenantId — separate from SMS/WhatsApp's, since each channel's real delivery provider is a separate account. */
export const EMAIL_PROVIDER_CONFIG_DATA = Symbol('EMAIL_PROVIDER_CONFIG_DATA');
export const EMAIL_PROVIDER_CONFIG = Symbol('EMAIL_PROVIDER_CONFIG');

export const SMS_PROVIDER_CONFIG_DATA = Symbol('SMS_PROVIDER_CONFIG_DATA');
export const SMS_PROVIDER_CONFIG = Symbol('SMS_PROVIDER_CONFIG');

export const WHATSAPP_PROVIDER_CONFIG_DATA = Symbol('WHATSAPP_PROVIDER_CONFIG_DATA');
export const WHATSAPP_PROVIDER_CONFIG = Symbol('WHATSAPP_PROVIDER_CONFIG');

/** A Map<NotificationChannel, NotificationSender> — which sender backs each channel name. Assembled by a factory, not a class Nest constructs directly. */
export const NOTIFICATION_CHANNEL_SENDERS = Symbol('NOTIFICATION_CHANNEL_SENDERS');

/** What feature/listener code actually injects — Notifier is a class, but this token is still what call sites depend on, so swapping the whole notification strategy later never touches a call site. */
export const NOTIFIER = Symbol('NOTIFIER');
