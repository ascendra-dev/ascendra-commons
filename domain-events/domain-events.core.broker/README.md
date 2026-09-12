# `domain-events.core.broker` — Model 2 (seam in place, transport not built)

A message broker (Kafka, RabbitMQ, SQS) with durable delivery, backoff, and a
dead-letter path — for once job *volume* or *variety*, or a real cross-service
integration, genuinely outgrows an in-process loop.

**Not built.** `BrokerDomainEventEmitter` throws
`BrokerTransportNotImplementedError` (naming which application hit it) on every
call. The seam — this package, the `DomainEventEmitter` interface in
`domain-events.core`, the `DOMAIN_EVENT_EMITTER` token — is real, so adopting a
broker later is a wiring change at the composition root, not a refactor of every
`emit()` call site. Shipping it as a loud stub is the honest state.

```typescript
DomainEventsModule.forRoot({
  emitterToken: BROKER_DOMAIN_EVENT_EMITTER,
  imports: [BrokerDomainEventEmitterModule.forRoot({ application: 'ascendra-pay' })],
})
```

## What a real implementation must resolve first

Not "swap the transport" — the guarantees genuinely change:

- **`emitCritical()`'s contract changes meaning.** In-process it rejects when an
  `@OnCriticalEvent()` listener fails, and the producer (running the listener in
  its own call stack) can roll back on that. Across a broker the handler is in
  another process — its failure cannot reach the producer. The most
  `emitCritical()` can mean here is "the event was durably enqueued": it rejects
  only if that enqueue fails. Handler failures become the broker's problem
  (at-least-once delivery, idempotent consumers, dead-letter queues). The
  standard shape is a **transactional outbox** written in the producer's own
  transaction plus a separate relay.
- **Payload deserialization.** Publish side is a plain `JSON.stringify`
  (`assertDomainEventSerializable` already enforces JSON-safety in every event's
  spec). Consume side needs a reviver (`occurredAt` comes back a string) and, if
  handlers depend on real class instances, an event-name → class registry.
- **Subscription model.** `@OnEvent()` / `@OnCriticalEvent()` + `DiscoveryService`
  is an in-process mechanism. Broker consumers need consumer groups, offsets,
  redelivery, dead-letter — a different registration path. **Every listener needs
  real review**, not a mechanical rename — see `domain-events.core`'s "thin
  dispatcher" note for what to do about that today.
- **Which events cross the boundary.** Not every in-process event should be
  published. That selection is a design decision, not a default.
- **Topic/queue naming across applications.** `DOMAIN_EVENTS_APPLICATION_ID` (bound
  by `forRoot({ application })`) is the seam — `${application}.${eventName}` as
  the topic, or `application` in the message envelope.

## Depends on

`domain-events.core`, `@nestjs/common`.
