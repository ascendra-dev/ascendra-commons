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
