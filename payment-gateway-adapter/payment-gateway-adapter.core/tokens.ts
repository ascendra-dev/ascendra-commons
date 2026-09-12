/**
 * Injection tokens. Symbols, not string literals — a typo in a binding is a
 * compile error, not a silently unbound provider.
 */

/** What a webhook controller injects — bound to whichever `WebhookEventLog` implementation the app wires. */
export const WEBHOOK_EVENT_LOG = Symbol('WEBHOOK_EVENT_LOG');

/** What an admin/observability caller injects — bound to a `WebhookObservabilityPort` implementation. */
export const WEBHOOK_OBSERVABILITY_PORT = Symbol('WEBHOOK_OBSERVABILITY_PORT');
