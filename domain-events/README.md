# Domain Events Pattern

Business logic never calls a notification sender or an audit writer directly —
it publishes an event, and each concern subscribes independently. That's what
lets subscribers be added or changed without ever touching the code that raises
the event.

There is a **real Model 1 / Model 2 split** — in-process dispatch vs a message
broker — so the module is a container of dot-named packages, the same shape as
`authorization` / `notification` / `audit-logging` / `background-jobs`:

| Package | Role | Depends on |
|---|---|---|
| **`domain-events.core`** | The contract — `DomainEventEmitter` port (`emit` / `emitCritical`), the `DomainEvent` marker, `assertDomainEventSerializable`, `OnCriticalEvent`, `DomainEventsModule.forRoot({ emitterToken, imports })`. **No transport implementation.** | `@nestjs/common`, `@nestjs/event-emitter` (for `OnCriticalEvent`) |
| **`domain-events.core.in-process`** (Model 1) | `InProcessDomainEventEmitter` + module (owns `EventEmitterModule.forRoot({ global: false })`). Listeners in the same process; `emitCritical()` runs inside the caller's transaction. | `domain-events.core`, `@nestjs/event-emitter` |
| **`domain-events.core.broker`** (Model 2) | `BrokerDomainEventEmitter` — a deliberate stub that throws `BrokerTransportNotImplementedError`. The seam is real (selector, interface, token); the transport is genuinely not built. Owns `DOMAIN_EVENTS_APPLICATION_ID` (a broker-only concern — topic naming). | `domain-events.core` |

Dependency direction is one-way toward `.core`. No `.api` — nothing to
administer or observe.

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

Both wire identically — a token plus the module that provides it. `emit()` /
`emitCritical()` call sites never change between transports; that's the whole
point of the `DOMAIN_EVENT_EMITTER` token.

## The pattern (in `domain-events.core`)

- **Domain event classes** — one per fact, defined by the consuming project.
  Named for what happened (`InvoiceSent`), never a command. Payload is the facts
  of the change, not just an id and not the whole entity. **Every field must be
  JSON-serializable** so Model 2 can enqueue it unchanged — enforce it from each
  event class's own `.spec.ts` with `assertDomainEventSerializable()`.
- **`DomainEventEmitter`** — `emit()` (fire-and-forget) / `emitCritical()`
  (awaited; a listener failure reaches the producer, who decides whether to roll
  back). The **entire** coupling surface for business logic.
- **`OnCriticalEvent`** — use instead of raw `@OnEvent()` for any listener whose
  failure must propagate through `emitCritical()`. `@OnEvent()` defaults to
  `suppressErrors: true`, which silently defeats `emitCritical()`'s contract.
- **Reliability is tiered by method, not by listener-author discipline.** If an
  event has *any* `@OnCriticalEvent()` listener, *every* producer of it must
  raise it with `emitCritical()`. Flag critical events in your per-module event
  catalog.

## `tenantId` — explicit on the event, never ambient

Not on `DomainEvent` — tenancy is a payload fact each concrete event class
carries (`InvoiceStatusChanged.tenantId`). It is **never** derived from
`AsyncLocalStorage` the way `audit-logging`'s correlation id is: a background
job runs one admin-scoped loop across *every* tenant's records in one call
chain, so ambient tenant context would be wrong for every event raised in it;
and ambient context can't cross a process boundary, which Model 2 must. A
listener bridging an event to `Notifier` reads `event.tenantId` and passes it
into `NotificationRequest.tenantId`.

## Consuming this module

`node ascendra-commons.js add domain-events.core.in-process` (brings
`domain-events.core` with it) — the transport is your choice, so name it. `audit-logging` and any other module
that depends on domain events depends on **`domain-events.core` only**.
