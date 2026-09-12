/**
 * Injection tokens for Model 2 (message-broker transport). Symbols, not string
 * literals.
 */

/**
 * What `BrokerDomainEventEmitterModule` exports as its `DomainEventEmitter`
 * implementation. Pass it to
 * `DomainEventsModule.forRoot({ emitterToken: BROKER_DOMAIN_EVENT_EMITTER })`.
 * Wires, but every call throws `BrokerTransportNotImplementedError` until a
 * real transport is built.
 */
export const BROKER_DOMAIN_EVENT_EMITTER = Symbol('BROKER_DOMAIN_EVENT_EMITTER');

/**
 * Which Ascendra application this process is (e.g. `'ascendra-pay'`) — a
 * **broker-only** concern: once multiple applications publish to one shared
 * broker cluster, `eventName` alone (`'invoice.created'`) is not enough to
 * avoid a topic/queue collision. The intended shape is `${application}.${eventName}`
 * as the topic name, or `application` stamped into the message envelope.
 *
 * Nothing in-process reads it — `domain-events.core` never touches it.
 * Module-prefixed (`DOMAIN_EVENTS_`) so it can't be confused with another
 * module's application token. Bound from `BrokerDomainEventEmitterModule.forRoot({ application })`.
 */
export const DOMAIN_EVENTS_APPLICATION_ID = Symbol('DOMAIN_EVENTS_APPLICATION_ID');
