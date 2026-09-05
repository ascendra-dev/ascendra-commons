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
 *   thrown error message — the one shipped injector of this token.
 * - Any future cross-cutting listener writing to a shared log/analytics sink
 *   that wants to tag its output by producing application can @Inject() this
 *   directly — provided the consumer supplied `application` to forRoot(). A
 *   module that always needs the value (rather than opting in) should instead
 *   take it through its own forRoot() and bind its own module-scoped token,
 *   the way `audit-logging`'s Postgres adapter does with
 *   AUDIT_APPLICATION_ID — that keeps it working even when the consumer never
 *   passes `application` to DomainEventsModule at all.
 *
 * Prefixed with the module folder name (DOMAIN_EVENTS_) so it can't be
 * confused with another module's application token on import — the same
 * per-module-prefix convention AUDIT_APPLICATION_ID follows. (DOMAIN_EVENT_EMITTER
 * predates this convention and keeps its singular form.)
 */
export const DOMAIN_EVENTS_APPLICATION_ID = Symbol('DOMAIN_EVENTS_APPLICATION_ID');
