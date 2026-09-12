/**
 * Injection tokens. Symbols, not string literals — a typo in a binding is a
 * compile error, not a silently unbound provider.
 */

/** What a controller/caller injects — bound to whichever `PaymentLinkTokenService` implementation the app wires. */
export const PAYMENT_LINK_TOKEN_SERVICE = Symbol('PAYMENT_LINK_TOKEN_SERVICE');

/** What a `PaymentLinkTokenService` implementation injects to log resolution attempts. Optional — falls back to `NoopTokenResolutionRecorder`. */
export const TOKEN_RESOLUTION_RECORDER = Symbol('TOKEN_RESOLUTION_RECORDER');

/** What an admin/observability caller injects — bound to a `TokenResolutionObservabilityPort` implementation. */
export const TOKEN_RESOLUTION_OBSERVABILITY_PORT = Symbol('TOKEN_RESOLUTION_OBSERVABILITY_PORT');
