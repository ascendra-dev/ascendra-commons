/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/** What AuditListener (shipped by this module — see audit-listener.ts) injects — bound to whichever AuditEventRepository implementation the app uses. */
export const AUDIT_EVENT_REPOSITORY = Symbol('AUDIT_EVENT_REPOSITORY');

/**
 * The one, fixed domain-event name every AuditRecordRaised is emitted under —
 * a plain string, not a symbol, since domain-event names are strings by
 * convention throughout this repo (see domain-events' own event-name
 * catalogs). Exported so producer code importing this library gets a
 * typo-proof constant to emit against, and so AuditListener's own
 * @OnCriticalEvent() subscribes to the same literal value — never
 * project-specific, unlike a business event's own name.
 */
export const AUDIT_EVENT_NAME = 'audit.record_raised';
