import { Injectable } from '@nestjs/common';
import { DomainEvent } from './domain-event.interface';
import { DomainEventEmitter } from './domain-event-emitter';

/** Thrown by every BrokerDomainEventEmitter method until a real Model 2 transport is built. */
export class BrokerTransportNotImplementedError extends Error {
  constructor() {
    super(
      'DomainEventsModule was imported with transport: "broker", but no message-broker ' +
        'transport is implemented yet. Use transport: "in-process" (the default), or implement ' +
        'BrokerDomainEventEmitter — see broker-domain-event-emitter.service.ts.',
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
 */
@Injectable()
export class BrokerDomainEventEmitter implements DomainEventEmitter {
  emit(_eventName: string, _event: DomainEvent): void {
    throw new BrokerTransportNotImplementedError();
  }

  async emitCritical(_eventName: string, _event: DomainEvent): Promise<void> {
    throw new BrokerTransportNotImplementedError();
  }
}
