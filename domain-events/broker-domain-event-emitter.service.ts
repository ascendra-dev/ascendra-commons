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
 * - emitCritical()'s contract. In-process, the listener runs inside the
 *   caller's transaction and a throw rolls the operation back. Across a broker
 *   the subscriber is in another process — that guarantee is physically
 *   impossible. Model 2 has to offer a weaker, explicit substitute (a
 *   transactional outbox written in the same transaction, at-least-once
 *   delivery, idempotent consumers) and the interface doc must be updated to
 *   say so.
 * - Payload serialization. Domain event classes are plain instances carrying
 *   `new Date()` and (potentially) methods. Over a broker they become JSON:
 *   `occurredAt` comes back a string, methods are gone. Either the DomainEvent
 *   contract constrains payloads to JSON-safe primitives, or an explicit
 *   serialize/deserialize step is defined here.
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
