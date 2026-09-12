import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent, DomainEventEmitter } from '../domain-events.core';
import { DOMAIN_EVENTS_APPLICATION_ID } from './tokens';

/** Thrown by every BrokerDomainEventEmitter method until a real Model 2 transport is built. */
export class BrokerTransportNotImplementedError extends Error {
  constructor(application: string) {
    super(
      `DomainEventsModule was imported by '${application}' with transport: "broker", but no ` +
        'message-broker transport is implemented yet. Use transport: "in-process" (the default), ' +
        'or implement BrokerDomainEventEmitter — see broker-domain-event-emitter.service.ts.',
    );
    this.name = 'BrokerTransportNotImplementedError';
  }
}

/**
 * Model 2 transport: a placeholder, deliberately unimplemented.
 *
 * The `forRoot({ transport })` seam, the DomainEventEmitter interface, and the
 * DOMAIN_EVENT_EMITTER token all exist now so that adopting a broker later is a
 * config change at the call site, not a refactor. This class is the one piece
 * that is genuinely not done — and shipping it as a stub that throws loudly is
 * the honest state, rather than an untested transport that looks real.
 *
 * A real implementation has to resolve, at minimum:
 *
 * - emitCritical()'s contract changes meaning. In-process, it rejects when an
 *   @OnCriticalEvent() listener fails, and the producer (running the listener
 *   in its own call stack) can roll back on that. Across a broker the handler
 *   is in another process — its failure cannot reach the producer at all. The
 *   most emitCritical() can mean here is "the event was durably enqueued": it
 *   rejects only if that enqueue fails (so the producer rolls back a
 *   never-published event), while handler failures become the broker's problem
 *   — at-least-once delivery, idempotent consumers, dead-letter queues. The
 *   standard shape is a transactional outbox written in the producer's own
 *   transaction plus a separate relay. The interface doc must be updated to
 *   spell this out.
 * - Payload deserialization. The DomainEvent contract already requires
 *   JSON-safe payloads (assert-domain-event-serializable.ts enforces it in
 *   every event's spec), so the publish side is a plain JSON.stringify. The
 *   consume side still needs a reviver — `occurredAt` comes back a string — and,
 *   if handlers depend on the event being a real class instance, an event-name
 *   -> class registry to rehydrate it.
 * - Subscription model. @OnEvent()/@OnCriticalEvent() + DiscoveryService is an
 *   in-process mechanism. Broker consumers need consumer groups, offsets,
 *   dead-letter queues and redelivery — a different registration path that
 *   this module would have to wire.
 * - Which events cross the process boundary. Not every in-process event should
 *   be published to a broker; that selection is a real design decision, not a
 *   default.
 * - Topic/queue naming across applications. `application` (injected below, from
 *   DomainEventsModule.forRoot({ application })) exists specifically for this:
 *   once multiple Ascendra applications publish to the same shared broker
 *   cluster, `eventName` alone ('invoice.created') is not enough to avoid one
 *   application's topic colliding with another's, or a consumer group
 *   cross-subscribing by accident. The intended shape is to publish under
 *   `${this.application}.${eventName}` (a Kafka topic prefix or SQS queue name,
 *   say) — or, if the broker's model favors one topic per event type with many
 *   producers, to at least stamp `application` into the message envelope/headers
 *   so a consumer can filter or attribute by producer. Either way, `eventName`
 *   itself stays exactly what call sites already pass — this is infrastructure
 *   the transport adds, never something call sites or @OnEvent() listeners need
 *   to know about.
 */
@Injectable()
export class BrokerDomainEventEmitter implements DomainEventEmitter {
  constructor(@Inject(DOMAIN_EVENTS_APPLICATION_ID) private readonly application: string) {}

  emit(_eventName: string, _event: DomainEvent): void {
    throw new BrokerTransportNotImplementedError(this.application);
  }

  async emitCritical(_eventName: string, _event: DomainEvent): Promise<void> {
    throw new BrokerTransportNotImplementedError(this.application);
  }
}
