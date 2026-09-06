# `domain-events.core.in-process` — Model 1

`EventEmitter2` (`@nestjs/event-emitter`), listeners in the same process. Not a
message broker. `emitCritical()` runs the listener synchronously inside the
producer's call stack, so if the producer opened a transaction around the emit
and rethrows what `emitCritical()` propagates, that transaction rolls back. The
emitter itself never touches a transaction — the rollback decision is the
producer's.

## Wiring

```typescript
DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
})
```

`InProcessDomainEventEmitterModule.forRoot()` owns
`EventEmitterModule.forRoot({ global: false })` — see its doc comment for why
`{ global: false }` (it closes the raw-`EventEmitter2` bypass of the
reliability tiering).

## Failure observability

`InProcessDomainEventEmitter` logs every swallowed/propagated failure through
NestJS's `Logger` (context `InProcessDomainEventEmitter`). Point your existing
observability tool (Sentry) at those logs via a small custom `LoggerService`
rather than building a recorder — see the notes that were in the old
`domain-events` README. A structured `EventDeliveryRecorder` port is a deferred
Model 1 extension, prose-only.

## When to move to Model 2

A real broker transport — `domain-events.core.broker` — is warranted only once a
concrete signal (a second deployed service, a real cross-service integration)
makes it necessary. It has real design work first (at-least-once delivery,
idempotent consumers, transactional outbox, `emitCritical()`'s contract
changing meaning across a process boundary). See `domain-events.core.broker`.

## Depends on

`domain-events.core`, `@nestjs/common`, `@nestjs/event-emitter`.
