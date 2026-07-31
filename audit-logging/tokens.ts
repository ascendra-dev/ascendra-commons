/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/** What the consumer's own listener class (see this pattern's README) injects — bound to whichever AuditEventRepository implementation the app uses. */
export const AUDIT_EVENT_REPOSITORY = Symbol('AUDIT_EVENT_REPOSITORY');
