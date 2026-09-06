/**
 * Injection token. A Symbol, not a string literal — same reasoning as every
 * other module in this library: a typo in a binding becomes a compile error,
 * not a silently unbound provider.
 *
 * `DomainEventEmitter` is a TypeScript interface (no runtime representation),
 * with the transport implementation chosen by which module the consumer wires
 * to `DomainEventsModule.forRoot({ emitterToken })` —
 * `IN_PROCESS_DOMAIN_EVENT_EMITTER` (Model 1) or `BROKER_DOMAIN_EVENT_EMITTER`
 * (Model 2). Call sites depend on this token, so switching transports never
 * touches a call site.
 */
export const DOMAIN_EVENT_EMITTER = Symbol('DOMAIN_EVENT_EMITTER');
