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

### `DomainEventEmitter` — the entire coupling surface for business logic

```typescript
// The entire coupling surface in, e.g., an invoice service:
this.domainEvents.emit(
  'invoice.status_changed',
  new InvoiceStatusChanged(invoiceId, tenantId, previousStatus, newStatus, actorId),
);
```

Business logic only ever calls `emit()` or `emitCritical()` — it never knows or
cares who is listening. Adding a new subscriber never requires a change to the
code that raises the event.

### Reliability is tiered by method, not by listener-author discipline

- **`emit(eventName, event): void`** — best-effort. Never awaited by the caller,
  never lets a listener's failure surface back to it — even a listener that forgot
  to catch its own error is backstopped internally. For subscribers like
  notifications, where a dropped delivery is a minor, recoverable inconvenience.
- **`emitCritical(eventName, event): Promise<void>`** — must-not-fail. Awaited by
  the caller; any listener's synchronous throw or async rejection propagates back.
  For subscribers like audit logging, where a silently dropped record is
  unacceptable and should fail the triggering operation's own transaction.

Both route through the underlying emitter's async dispatch uniformly, so a
listener can be sync or async without the caller needing to know which — only
whether the result is awaited/propagated differs between the two methods.

## Implementations

- `EventEmitter2` (via `@nestjs/event-emitter`) — an in-process emitter, not a
  message broker (Kafka, RabbitMQ, SQS, or any externally-run system). A broker is
  infrastructure to operate and monitor, unwarranted for a single deployed
  application with no dedicated ops team.
- A message broker is a future target only if a genuine need to share events
  across independently deployed services appears — not a default, and not
  something to anticipate before that need is concrete.

## Model 1 — In-Process Event Emitter, Tiered Reliability (current)

What's shipped in this folder: `DomainEventsModule` (wraps
`EventEmitterModule.forRoot()`), `DomainEventEmitter` (the `emit`/`emitCritical`
service above), and the `DomainEvent` marker interface. No delivery persistence
across a process crash — acceptable for best-effort subscribers at this stage;
must-not-fail reliability instead comes from `emitCritical` running inside the
same request/transaction as the triggering operation, not from the event
mechanism itself.

## Model 2 — Message Broker (future target)

A real message broker, adopted only once a concrete signal (a second deployed
service, a real cross-service integration) makes it necessary. Same event-class
convention; only the transport changes, and only for subscribers that genuinely
live in a separate deployment.

## Consuming this module

Copy the `domain-events/` folder verbatim into the consumer project's `src/`.
Import only from `src/domain-events` (the `index.ts` barrel) — never a file
inside the folder directly:

```typescript
import { DomainEventsModule, DomainEventEmitter, DomainEvent } from '@/domain-events';
```
