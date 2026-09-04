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

/**
 * Identifies which Ascendra application (e.g. 'ascendra-pay',
 * 'ascendra-school-erp') this process is — bound from
 * DomainEventsModule.forRoot({ application }). Not consumed by
 * InProcessDomainEventEmitter (a single process has nothing to disambiguate
 * from), but exported so:
 *
 * - BrokerDomainEventEmitter (Model 2) can prefix topics/queues with it once
 *   built, so two applications publishing to the same shared broker cluster
 *   never collide on eventName alone.
 * - Any cross-cutting listener that wants to tag its own output by producing
 *   application (audit-logging, a shared log/analytics sink) can @Inject()
 *   this directly, without depending on which transport is active.
 *
 * Bound under both transports, not just 'broker' — the identity of "which
 * app is this" doesn't depend on how events happen to be transported.
 */
export const APPLICATION_ID = Symbol('APPLICATION_ID');
