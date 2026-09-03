# Domain Events Pattern

## Overview

Business logic (Invoice, Payment, Workflow services, or any equivalent in a
different project) must never call a notification sender or an audit writer
directly — it publishes an event, and each concern subscribes independently. This
is what lets notifications, audit logging, and any future subscriber be added or
changed without ever touching the code that raises the event.

## The pattern

### Domain event classes — one per fact, defined by the consuming project

```typescript
import { DomainEvent } from './domain-event.interface';

export class InvoiceStatusChanged implements DomainEvent {
  readonly occurredAt = new Date();
  constructor(
    public readonly invoiceId: string,
    public readonly tenantId: string,
    public readonly previousStatus: string,
    public readonly newStatus: string,
    public readonly changedBy: string,
  ) {}
}
```

This class is illustrative, not shipped — each consuming project defines its own
event classes for its own facts. The only thing this library fixes is the
`DomainEvent` marker interface (`occurredAt: Date`), so every event is uniformly
shaped for consumers like an audit listener that need a timestamp regardless of
which specific event they're handling.

Events are named for what already happened (`InvoiceSent`, `PaymentConfirmed`),
never as a command or intent. The payload is scoped to the facts of the action —
not just an id (a subscriber re-querying current state may read a value that has
already changed again by the time it runs, which is specifically wrong for an
audit trail's before/after requirement), and not the entire serialized entity.
Subscribers that need more context than the event carries fetch it themselves.

**Recommended, not enforced by this library:** give each domain module its own
catalog of event-name constants, the same reasoning `authorization-model-pattern.md`
already applies to its `Actions` catalog — a bare string like `'invoice.status_changed'`
typed out at both the raise site and every listener means a typo silently breaks
the connection, with no compile error. A small `InvoiceEvents = { STATUS_CHANGED:
'invoice.status_changed' } as const` per module, imported by both the raiser and
its listeners, turns that typo into a wrong identifier instead.

### `DomainEventEmitter` — the entire coupling surface for business logic

`DomainEventEmitter` is a TypeScript **interface** (`emit` / `emitCritical`), not
a class. Business logic injects it via the `DOMAIN_EVENT_EMITTER` token, so the
transport underneath (see Model 1 / Model 2 below) is chosen once, at module
import, and never leaks into a call site:

```typescript
import { DOMAIN_EVENT_EMITTER, DomainEventEmitter } from '@/ascendra-commons/domain-events';

@Injectable()
export class InvoiceService {
  constructor(
    @Inject(DOMAIN_EVENT_EMITTER) private readonly domainEvents: DomainEventEmitter,
  ) {}

  // The entire coupling surface in, e.g., an invoice service:
  async changeStatus(/* ... */) {
    // ...
    this.domainEvents.emit(
      'invoice.status_changed',
      new InvoiceStatusChanged(invoiceId, tenantId, previousStatus, newStatus, actorId),
    );
  }
}
```

Business logic only ever calls `emit()` or `emitCritical()` — it never knows or
cares who is listening, or which transport is bound. Adding a new subscriber, or
switching transports, never requires a change to the code that raises the event.

### Reliability is tiered by method, not by listener-author discipline

- **`emit(eventName, event): void`** — fire-and-forget. Never awaited by the
  caller, never lets a listener's failure surface back to it — even a listener
  that forgot to catch its own error is backstopped internally. For subscribers
  like notifications, where a dropped delivery is a minor, recoverable
  inconvenience.
- **`emitCritical(eventName, event): Promise<void>`** — awaited. If the receiver
  fails, or any `@OnCriticalEvent()` listener throws or rejects, `emitCritical()`
  rejects and the error reaches the producer. For subscribers like audit
  logging, where a silently dropped record is unacceptable.

Both route through the underlying emitter's async dispatch uniformly, so a
listener can be sync or async without the caller needing to know which — only
whether the result is awaited/propagated differs between the two methods.

### Deciding whether to roll back is the producer's job

`emitCritical()` never touches a transaction and never rolls anything back — it
only propagates the failure. The producer catches it and decides:

```typescript
try {
  await this.domainEvents.emitCritical(InvoiceEvents.STATUS_CHANGED, event);
} catch (err) {
  // a listener failed. rethrow to let this operation's transaction roll back,
  // or log it and carry on to commit anyway — the producer's call, per case.
  throw err;
}
```

"emitCritical" names the producer's intent to *be told about* a failure, not an
automatic rollback. The producer neither knows nor names the listeners: **"a
listener failed" is the entire signal.** `emitCritical()` does not say which one
and does not aggregate — it rejects with one of the failures, and every
`@OnCriticalEvent()` listener still runs. A listener that wants the producer to
branch on *why* it failed should throw a distinguishable error type of its own.

Under the in-process transport an `@OnCriticalEvent()` listener runs
synchronously inside the producer's call stack, so rethrowing rolls back a
transaction opened around the emit. Under a broker (Model 2) an `emitCritical()`
rejection would instead mean the event could not be durably enqueued — a handler
failure in another process can't reach the producer at all.

**Critical: a listener must use `@OnCriticalEvent()`, not the plain `@OnEvent()`,
for `emitCritical()`'s propagation to actually happen.** `@OnEvent()` defaults to
`{ suppressErrors: true }` — NestJS's own `EventSubscribersLoader` catches
whatever the listener throws, logs it, and does not re-throw, regardless of
which method raised the event. Left as the default, this silently defeats
`emitCritical()`'s entire contract: the caller's `await` resolves normally while
the listener's failure gets logged and dropped, with nothing signaling the
mismatch. Use the decorator this library ships specifically to make the correct
choice the default instead of something every critical listener's author has to
remember:

```typescript
import { OnCriticalEvent } from './domain-events';

@Injectable()
export class AuditListener {
  @OnCriticalEvent('invoice.status_changed')
  async onInvoiceStatusChanged(event: InvoiceStatusChanged) {
    await this.auditRepo.insert(/* ... */); // a throw here now genuinely propagates
  }
}
```

A plain `@OnEvent()` is still correct for a listener meant to be reached only via
`emit()` (best-effort) — the distinction only matters for listeners subscribed to
an event that's also raised via `emitCritical()`.

### Pairing the producer method with the listener decorator

Criticality is a property of **the event**, not of one call site. The producer
picks `emit()` vs `emitCritical()` from the event's own characteristics — is a
dropped delivery a minor inconvenience, or must a subscriber's failure be able to
fail the triggering operation? — and every producer of that event picks the same
way. The listener then matches:

| Producer | Listener | Result |
|---|---|---|
| `emit()` | `@OnEvent()` | ✅ best-effort both sides |
| `emit()` | `@OnCriticalEvent()` | ⚠️ broken — the producer never awaits, so the listener's failure propagates nowhere and, because `@OnCriticalEvent()` also turns off NestJS's error logging, is dropped with no trace |
| `emitCritical()` | `@OnEvent()` | ✅ if the listener is genuinely best-effort (awaited, but its failure is logged and swallowed, never rolls the producer back); ❌ a silent bug if it was meant to be critical |
| `emitCritical()` | `@OnCriticalEvent()` | ✅ critical both sides — the listener's failure reaches the producer |

**Rule:** if an event has *any* `@OnCriticalEvent()` listener, *every* producer of
it must raise it with `emitCritical()`. Best-effort listeners on that same event
still use plain `@OnEvent()` — that is how one event carries mixed criticality
(an audit listener that can roll the producer back, a metrics listener that
cannot).

**Flag critical events in the catalog.** The per-module event-name catalog is the
shared contract both sides read — mark which events are critical so a listener
author knows to reach for `@OnCriticalEvent()` and a producer knows to use
`emitCritical()`:

```typescript
export const InvoiceEvents = {
  /** critical — audit logging subscribes; raise with emitCritical() */
  STATUS_CHANGED: 'invoice.status_changed',
  /** best-effort — raise with emit() */
  REMINDER_DUE: 'invoice.reminder_due',
} as const;
```

Adding the *first* `@OnCriticalEvent()` listener to a previously best-effort event
means updating both its catalog flag and every producer's call site from `emit()`
to `emitCritical()`.

## Choosing a transport

`DomainEventsModule.forRoot({ transport })` selects which implementation of the
`DomainEventEmitter` interface is bound to `DOMAIN_EVENT_EMITTER`:

```typescript
DomainEventsModule.forRoot()                        // 'in-process' — the default
DomainEventsModule.forRoot({ transport: 'broker' }) // Model 2 — not implemented yet
```

- **`'in-process'`** — `InProcessDomainEventEmitter`, backed by `EventEmitter2`
  (`@nestjs/event-emitter`). Not a message broker (Kafka, RabbitMQ, SQS). A
  broker is infrastructure to operate and monitor, unwarranted for a single
  deployed application with no dedicated ops team.
- **`'broker'`** — `BrokerDomainEventEmitter`, a deliberate placeholder that
  throws `BrokerTransportNotImplementedError` on every call. The option, the
  interface, and the token all exist now so that adopting a broker later is a
  one-line `forRoot()` change at the composition root, not a refactor of every
  call site — but the transport itself is genuinely not built, and shipping it
  as a loud stub is the honest state.

## Model 1 — In-Process Event Emitter, Tiered Reliability (current)

What's shipped in this folder: `DomainEventsModule` (a dynamic module whose
`forRoot({ transport })` wires one transport — the `'in-process'` path also
imports `EventEmitterModule.forRoot({ global: false })`, see below), the
`DomainEventEmitter` interface, `InProcessDomainEventEmitter` (the
`emit`/`emitCritical` implementation above), `BrokerDomainEventEmitter` (the
Model 2 stub), the `DOMAIN_EVENT_EMITTER` token, `OnCriticalEvent` (the decorator
`emitCritical()` actually depends on to keep its contract), and the `DomainEvent`
marker interface. No delivery persistence across a process crash — acceptable
for best-effort subscribers at this stage; must-not-fail reliability instead
comes from `emitCritical` running inside the same request/transaction as the
triggering operation, not from the event mechanism itself.

**Why `{ global: false }` (in-process path only):** `EventEmitterModule.forRoot()`
defaults to `global: true`, which would make the raw `EventEmitter2` injectable
from any module anywhere in the app, without importing `DomainEventsModule` at
all — letting a developer bypass `emit()`/`emitCritical()`'s reliability-tiering
entirely (`constructor(private emitter: EventEmitter2)`), with nothing to
signal the bypass happened. `{ global: false }` closes that: `EventEmitter2` (and
the `DOMAIN_EVENT_EMITTER` binding) are only injectable by modules that actually
import `DomainEventsModule`. This does not affect `@OnEvent()`/`@OnCriticalEvent()`
listener discovery — `@nestjs/event-emitter`'s `EventSubscribersLoader` scans
every provider in the app via NestJS's `DiscoveryService` regardless of any
module's `global` setting.

## Model 2 — Message Broker (seam in place, transport not built)

The `forRoot({ transport: 'broker' })` selector, the `DomainEventEmitter`
interface, and the `DOMAIN_EVENT_EMITTER` token exist so the call sites are
already transport-agnostic. `BrokerDomainEventEmitter` is a stub — a real
implementation is warranted only once a concrete signal (a second deployed
service, a real cross-service integration) makes it necessary, and it has real
design work to resolve first, not just "swap the transport":

- **`emitCritical()`'s contract is transport-dependent.** In-process, the
  listener runs inside the caller's transaction, so a throw rolls the triggering
  operation back. Across a broker the subscriber is in another process — that
  guarantee is physically impossible. Model 2 has to offer a weaker, explicit
  substitute (transactional outbox, at-least-once delivery, idempotent
  consumers), and this interface's doc must be updated to say so.
- **Payload serialization.** Event classes carry `new Date()` and possibly
  methods; over a broker they become JSON. Either `DomainEvent` constrains
  payloads to JSON-safe primitives, or an explicit serialize/deserialize step is
  defined.
- **Subscription model.** `@OnEvent()` / `@OnCriticalEvent()` + `DiscoveryService`
  is in-process. Broker consumers need consumer groups, offsets, dead-letter
  queues, redelivery.
- **Which events cross the boundary.** Not every in-process event should be
  published to a broker; that selection is a design decision, not a default.

See `broker-domain-event-emitter.service.ts` for this list in code.

## Consuming this module

Copy the `domain-events/` folder verbatim into the consumer project's
`src/ascendra-commons/domain-events/` — see `module-packaging-pattern.md` for why
vendored patterns land under one wrapper folder rather than as flat top-level
siblings. Import only from that folder's `index.ts` barrel — never a file inside
it directly:

```typescript
import {
  DomainEventsModule,
  DOMAIN_EVENT_EMITTER,
  DomainEventEmitter, // type only — inject via the token above
  DomainEvent,
  OnCriticalEvent,
} from '@/ascendra-commons/domain-events';
```

Wire it once at the composition root:

```typescript
@Module({
  imports: [DomainEventsModule.forRoot()], // { transport: 'in-process' } is the default
})
export class AppModule {}
```

Then inject `DOMAIN_EVENT_EMITTER` wherever business logic raises events (see the
`DomainEventEmitter` section above for the constructor shape).
