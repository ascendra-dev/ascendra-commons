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
 * InProcessDomainEventEmitter itself (a single process has nothing to
 * disambiguate from), so under transport: 'in-process' it's bound only if
 * `application` was actually supplied (opt-in — see the module's own doc
 * comment); under transport: 'broker' it's required and always bound, since
 * BrokerDomainEventEmitter already consumes it. Exists for:
 *
 * - BrokerDomainEventEmitter (Model 2) to prefix topics/queues with it once
 *   built, so two applications publishing to the same shared broker cluster
 *   never collide on eventName alone. Already used today in the stub's
 *   thrown error message.
 * - Any cross-cutting listener that wants to tag its own output by producing
 *   application (audit-logging, a shared log/analytics sink) can @Inject()
 *   this directly, without depending on which transport is active — as long
 *   as `application` was supplied to forRoot() in the first place.
 */
export const APPLICATION_ID = Symbol('APPLICATION_ID');
