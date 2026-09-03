/**
 * Injection token. A Symbol, not a string literal — the same reasoning
 * `notification/tokens.ts` and `authorization/tokens.ts` give: a typo in a
 * binding becomes a compile error, not a silently unbound provider.
 *
 * This token exists because DomainEventEmitter is now a TypeScript interface
 * (no runtime representation — nothing can be "injected as" one without a
 * token), with the transport implementation chosen by
 * DomainEventsModule.forRoot({ transport }). Call sites depend on this token,
 * so switching transports later never touches a call site.
 */
export const DOMAIN_EVENT_EMITTER = Symbol('DOMAIN_EVENT_EMITTER');
