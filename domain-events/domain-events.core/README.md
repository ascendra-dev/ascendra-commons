# `domain-events.core` — the contract, transport-agnostic

Business logic publishes an event; each concern (notification, audit logging,
…) subscribes independently. This package fixes the **producer** surface;
neither transport implementation lives here.

There *is* a real Model 1 / Model 2 split — in-process dispatch vs a message
broker — so each transport is its own package:

- **`domain-events.core.in-process`** (Model 1) — `EventEmitter2`, listeners in
  the same process, `emitCritical()` runs inside the caller's transaction.
- **`domain-events.core.broker`** (Model 2) — a deliberate stub that throws
  `BrokerTransportNotImplementedError`; the seam (selector, interface, token)
  is real so adopting a broker later is a wiring change, not a refactor.

## What's in here

| Piece | Purpose |
|---|---|
| `DomainEventEmitter` (`domain-event-emitter.port.ts`) | `emit(name, event): void` (fire-and-forget) / `emitCritical(name, event): Promise<void>` (awaited; a listener failure reaches the producer). The **entire** coupling surface for business logic — injected via `DOMAIN_EVENT_EMITTER`. |
| `DomainEvent` (`domain-event.interface.ts`) | Marker — `occurredAt: Date`. Each consuming project defines one plain class per fact. Every field must be JSON-serializable (so Model 2 can enqueue it unchanged). |
| `assertDomainEventSerializable()` | Design-time guard — call it from each event class's own `.spec.ts`. Throws listing anything `JSON.stringify` would drop/corrupt. |
| `OnCriticalEvent` | Listener decorator — `@OnEvent()` with `suppressErrors: false`, so an `emitCritical()` listener's failure actually propagates. |
| `DomainEventsModule.forRoot({ emitterToken, imports })` | Pure token wiring — aliases `DOMAIN_EVENT_EMITTER` to `emitterToken`. |

## The listener side has no transport seam

`@OnEvent()` / `@OnCriticalEvent()` are raw `@nestjs/event-emitter` decorators —
they work only because in-process everything runs on one `EventEmitter2`. Under
a broker every listener needs real review (at-least-once delivery, no
transactional rollback, ack semantics). `OnCriticalEvent` lives here as the
*critical-listener contract marker*, but the mechanism is in-process today.
**Write every decorated method as a thin dispatcher** calling a plain function
for the real logic — that shrinks the Model 2 rework (`audit-logging`'s
`AuditListener` is the reference).

## Wiring

```typescript
// Model 1 — the normal case
DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
})

// Model 2 — wires, throws on first emit
DomainEventsModule.forRoot({
  emitterToken: BROKER_DOMAIN_EVENT_EMITTER,
  imports: [BrokerDomainEventEmitterModule.forRoot({ application: 'ascendra-pay' })],
})
```

## `applicationId` / `tenantId`

Neither is in `.core`. `tenantId` is a payload fact each concrete event class
carries itself (never derived from ambient context — see the split note below).
`application` is a **broker-only** concern (topic naming across apps) and lives
entirely in `domain-events.core.broker`; nothing in-process reads it.

## Depends on

`@nestjs/common`, `@nestjs/event-emitter` (for `OnCriticalEvent`).
