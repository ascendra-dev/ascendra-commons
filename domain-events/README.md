# Domain Events Pattern

## Overview

Business logic (Invoice, Payment, Workflow services, or any equivalent in a
different project) must never call a notification sender or an audit writer
directly — it publishes an event, and each concern subscribes independently. This
is what lets notifications, audit logging, and any future subscriber be added or
changed without ever touching the code that raises the event.

Built and audited against `MODULE-STANDARD.md` (this repo's root) — the
cross-module checklist for packaging, `applicationId`/`tenantId`, the Model
1/Model 2 split, and more.

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

**No `tenantId` on `DomainEvent` itself** — deliberately N/A, not an
oversight. Tenancy is a payload-specific fact each concrete event class
carries itself when relevant (`InvoiceStatusChanged.tenantId` above), the way
`audit-logging`'s own `AuditRecordRaised.tenantId` carries it explicitly for
the audit trail. The transport/interface layer has no use for it: dispatch, in-process
or broker, doesn't route or filter on tenancy — every listener in the process
receives every event regardless, and it's the listener's own job to read the
payload's tenant field if it cares. See "Application identity" below for the
one identity concept this layer *does* need to know about, and why it's a
different thing from a per-event `tenantId`.

**Explicit on the event, never derived from ambient context — this is a firm
rule, not a style preference.** A listener that needs the tenant reads
`event.tenantId` off the payload. It is never derived from something like
`AsyncLocalStorage` the way `audit-logging`'s correlation id is, for two
reasons:

- **There's often no single "current tenant" to derive.** `background-jobs`'
  own worked example runs one admin-scoped loop across *every* tenant's
  overdue invoices in a single execution — invoice A (tenant 1), then invoice
  B (tenant 2), same call chain throughout. Ambient tenant context would be
  wrong for every event raised in that loop; `event.tenantId` is correct
  regardless, because it's a fact about the invoice, not about the execution.
- **Ambient context cannot cross a process boundary**, and this has to
  eventually, under Model 2 — the same "every field must be JSON-serializable"
  requirement `DomainEvent` already enforces for everything else. An explicit
  field travels with the payload for free; ambient context is simply gone the
  instant a listener runs in a different process.

Contrast with correlation id, which *is* right to keep ambient: it answers
"which execution is this" (constant for everything inside one run), not
"which tenant does this fact belong to" (which can change record-to-record
within the same run). Same mechanism family, different question — don't
generalize "correlation id uses context" into "tenant id should too."

This is also the concrete mechanism behind "a specific tenant wants different
notification treatment" (see `notification`'s README): a listener bridging a
domain event to `Notifier` reads `event.tenantId` and passes it straight into
`NotificationRequest.tenantId`:

```typescript
@OnCriticalEvent('invoice.status_changed')
async handle(event: InvoiceStatusChanged) {
  await this.notifier.notify({
    recipient: { type: 'user', id: event.changedBy },
    notificationType: 'invoice.status_changed',
    variables: { /* ... */ },
    tenantId: event.tenantId, // straight from the event's own field
  });
}
```

Events are named for what already happened (`InvoiceSent`, `PaymentConfirmed`),
never as a command or intent. The payload is scoped to the facts of the action —
not just an id (a subscriber re-querying current state may read a value that has
already changed again by the time it runs, which is specifically wrong for an
audit trail's before/after requirement), and not the entire serialized entity.
Subscribers that need more context than the event carries fetch it themselves.

**Every event must be JSON-serializable**, so the broker transport (Model 2) can
put it on a queue unchanged: fields are primitives, plain objects/arrays, or
`Date` — no methods (events carry data, not behaviour), no `Map`/`Set`/`BigInt`/
`undefined`/other class instances. Model 1 passes the live instance in-process
and doesn't need this, but adopting the constraint now is the cheap hedge that
makes Model 2 a non-event. Enforce it from each event class's own `.spec.ts`:

```typescript
import { assertDomainEventSerializable, JsonValue } from '@/ascendra-commons/domain-events';

it('is serializable', () => {
  assertDomainEventSerializable(
    new InvoiceStatusChanged('inv_1', 'ten_1', 'draft', 'sent', 'usr_1'),
  );
});
```

`assertDomainEventSerializable()` walks the event recursively and throws
`DomainEventNotSerializableError` listing anything `JSON.stringify` would drop,
corrupt, or throw on (functions, `undefined`, `NaN`/`Infinity`, `Map`/`Set`,
non-`Date` class instances, circular refs). An optional compile-time companion
catches wrong field *types* before the test runs:

```typescript
({ ...event }) satisfies Record<string, JsonValue | Date>;
```

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

### Keep the decorated method a thin dispatcher

Unlike the producer side (`DomainEventEmitter` — an interface, fully
transport-agnostic), **the listener side has no portability seam at all.**
`@OnEvent()`/`@OnCriticalEvent()` are raw `@nestjs/event-emitter` decorators —
they only work because NestJS's `EventSubscribersLoader` wires them straight
to the same in-process `EventEmitter2` instance `InProcessDomainEventEmitter`
wraps. See "Model 2" below for why this can't just be swapped for an
equivalent broker decorator later — every listener will need real review, not
a search-and-replace.

The one thing worth doing *today*, at no cost, to shrink that future rework:
write every `@OnEvent()`/`@OnCriticalEvent()`-decorated method as a thin
dispatcher that immediately calls a plain, undecorated method or function for
the actual logic — never put real logic in the decorated method body.
`audit-logging`'s own shipped `AuditListener` already does this — and does so
*by construction*, not just by discipline, since a single fixed event name
gives it exactly one thing to do:
`AuditListener.handle()` is the decorated method, and it does nothing but call
the plain `persistAuditRecord()`. When Model 2 lands, only the dispatcher gets
rewritten to whatever the broker consumer's own registration looks like; the
logic underneath doesn't move. This narrows the blast radius, it doesn't
eliminate it — the logic itself may still need real changes for idempotency
under at-least-once delivery (see below).

## Application identity

`DomainEventsModule.forRoot({ application })` is required only under
`transport: 'broker'` — `BrokerDomainEventEmitter` already consumes it (it
names the application in every error it throws; see its own file for the
intended topic-naming use once a real transport exists). Under `'in-process'`
it's optional: nothing in this module reads it there, so `forRoot()` with no
argument at all remains the normal call — the same promise this module made
before `application` existed. Supplying it under `'in-process'` anyway is
meaningful only if some *other* provider you're adding wants to
`@Inject(DOMAIN_EVENTS_APPLICATION_ID)` (see below); if you don't supply it, the
token simply isn't bound — injecting it fails loudly rather than silently
resolving to `undefined`.

This exists because `ascendra-commons` is copy-distributed (see "Consuming
this module" below) — `ascendra-pay` and, say, `ascendra-school-erp` each run
their own copy of this module in their own process, so `eventName` alone
(`'invoice.created'`) is never ambiguous *today*: each process has exactly one
application's events flowing through it. It becomes ambiguous the moment
multiple applications publish to a **shared** destination — a broker cluster
under Model 2, or a shared log/analytics sink consumed by more than one
application's output (`audit-logging`'s README, "the module to watch," sketches
the latter). `DOMAIN_EVENTS_APPLICATION_ID` is the identifier that disambiguates
that later, without any call site (`emit()`, `@OnEvent()`, and so on) ever
needing to know about it.

This is deliberately *not* solved by prefixing `eventName` itself — that would
couple every `@OnEvent('invoice.created')` decorator to a per-application
string for zero benefit in-process (there is nothing to disambiguate from
within one process). `DOMAIN_EVENTS_APPLICATION_ID` is consumed only where a
shared destination actually exists — which, today, is only the broker stub's
error message; the token exists for the broker path and for any future consumer
that opts in. A module that *always* needs the application value takes it
through its own `forRoot()` instead (see `audit-logging`'s Postgres adapter and
its `AUDIT_APPLICATION_ID`) — that keeps it working even when the consumer
never passes `application` to this module.

## Choosing a transport

`DomainEventsModule.forRoot({ transport })` selects which implementation of
the `DomainEventEmitter` interface is bound to `DOMAIN_EVENT_EMITTER`:

```typescript
DomainEventsModule.forRoot()                                                      // 'in-process' — the default, no config needed
DomainEventsModule.forRoot({ application: 'ascendra-pay', transport: 'broker' })  // Model 2 — not implemented yet, application required
```

- **`'in-process'`** — `InProcessDomainEventEmitter`, backed by `EventEmitter2`
  (`@nestjs/event-emitter`). Not a message broker (Kafka, RabbitMQ, SQS). A
  broker is infrastructure to operate and monitor, unwarranted for a single
  deployed application with no dedicated ops team.
- **`'broker'`** — `BrokerDomainEventEmitter`, a deliberate placeholder that
  throws `BrokerTransportNotImplementedError` (naming which application hit
  it) on every call. The option, the interface, and the token all exist now so
  that adopting a broker later is a one-line `forRoot()` change at the
  composition root, not a refactor of every call site — but the transport
  itself is genuinely not built, and shipping it as a loud stub is the honest
  state.

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

### Failure observability — what gets logged today, and by whom

Best-effort and critical failures are **not** symmetric here, and it matters
for how you'd actually notice a real production failure:

- **Best-effort (`@OnEvent()`, default `suppressErrors: true`):** NestJS's own
  `EventSubscribersLoader` catches the throw, logs it via NestJS's default
  `Logger` (console, unless your app configures otherwise), and swallows it —
  *before* it ever reaches this module's code. A log line exists automatically
  today; it's unstructured and easy to miss under volume, but it isn't silent.
- **Critical (`@OnCriticalEvent()`, `suppressErrors: false`):** NestJS's loader
  does **not** log — it just re-throws, straight to the producer. Whether it
  ever gets logged used to depend entirely on the producer's own error
  handling, and the documented, legitimate pattern is "the producer swallows
  and commits anyway" (see "Deciding whether to roll back is the producer's
  job" above) — meaning a silently-swallowed critical failure could leave
  **zero trace anywhere**. `InProcessDomainEventEmitter.emitCritical()` now
  logs the failure itself (event name + `JSON.stringify(event)`, since
  serializability is already guaranteed) before rethrowing unchanged — this
  doesn't touch the producer's rollback-or-swallow decision at all, it just
  guarantees a trace exists regardless of what the producer then does.
- **`emit()`'s two internal catch points** (an async rejection reaching
  `emit()`, and the rare case of `emitAsync()` itself throwing synchronously)
  now log too, instead of discarding silently. The async case is also what
  catches the mismatched-pairing bug in "Pairing the producer method with the
  listener decorator" above (`emit()` + `@OnCriticalEvent()`) — previously
  "dropped with no trace" per that section's own table; now at least visible
  in logs.

**What this doesn't give you:** a structured, queryable record of "did event
X's delivery succeed" — only log lines. That's fine — see below for the
practical way to turn these log lines into a real notification, before
reaching for the "Not built" fallback further down.

### The practical path: point your existing observability tool at these logs, don't build a recorder

`InProcessDomainEventEmitter` uses NestJS's standard `Logger`
(`new Logger(InProcessDomainEventEmitter.name)`) — every failure above goes
through it, with `InProcessDomainEventEmitter` as the log `context`. Turning
that into a real notification (Slack/email/PagerDuty) needs one small,
one-time piece of app-level setup, not a change to this module:

NestJS's default `Logger` writes via `console.error` internally, and an
observability tool's automatic instrumentation only catches genuinely
*unhandled* exceptions reaching the HTTP layer by default — it does **not**
turn an explicit `this.logger.error(...)` call into an event on its own. The
piece that actually captures it: a small custom `LoggerService` (Sentry's
docs and community examples call this pattern out directly for NestJS —
extend `ConsoleLogger`, override `error()` to also call
`Sentry.captureException()`/`captureMessage()`, then `app.useLogger(new SentryLogger())`
in `main.ts`). About 10–15 lines, written once, in `ascendra-pay`'s own code.
From then on every `Logger.error()` call in the app — these included — becomes
a real event, and the `context` argument can be passed through as a tag, so an
alert rule can be scoped specifically to event-delivery failures rather than
"any error anywhere."

This is deliberately an app-level decision, not something this module
prescribes — same as every other place in this codebase that stays silent on
deployment/observability specifics. Sentry (not Datadog) is the practical
choice at this stage: its free tier is a real, permanent tier (not a trial)
sized for a solo/early project, and it's purpose-built for exactly this
problem — Datadog is a much broader, materially more expensive platform
(per-host and per-GB pricing) built for teams with dedicated ops budget.
Concretely: reach for Sentry before reaching for the "Not built" recorder
below. A recorder duplicates aggregation, retention, search, and alerting that
Sentry already does well; it's a worse version of the same thing, built and
maintained by you alone, for a problem that isn't showing up as a real
incident yet.

### Not built: structured delivery-outcome recording — a real Model 1 extension, not Model 2

Recorded so it isn't lost, not built speculatively — same treatment
`background-jobs` gives its own not-yet-built `JobRunRecorder`, and
`audit-logging` gives its own not-yet-built read/query API. Reach for this
only if a real observability tool turns out to be insufficient for a genuine
need (e.g. a custom in-app "event health" admin page) — not as a first
response to "how do I get notified." The design, when that story asks for it:

```typescript
export interface EventDeliveryFailure {
  eventName: string;
  criticality: 'best_effort' | 'critical';
  occurredAt: Date;
  error: string;
}

export interface EventDeliveryRecorder {
  recordFailure(failure: EventDeliveryFailure): Promise<void>; // best-effort — must never itself throw
}
```

`InProcessDomainEventEmitter` would call `recorder.recordFailure(...)` from
the same catch points that already log today, wrapped in its own try/catch so
a failure to *record* the outcome can never mask or compound the real one —
the same reliability posture `background-jobs`' own deferred
`JobRunRecorder` design already uses, for the same reason (a recorder must
never itself become a second point of failure). Only failures need recording
here, unlike `JobRunSummary` — there's no equivalent of "did the run happen at
all" for an event dispatch the way there is for a scheduled job, since `emit()`
and `emitCritical()` are synchronous calls whose own success is already known
to the caller.

## Model 2 — Message Broker (seam in place, transport not built)

The `forRoot({ transport: 'broker' })` selector, the `DomainEventEmitter`
interface, and the `DOMAIN_EVENT_EMITTER` token exist so **producer** call
sites (`emit()`/`emitCritical()`) are already transport-agnostic.
**Listener** call sites are not — see "Keep the decorated method a thin
dispatcher" above, and the "Subscription model" bullet below: every
`@OnEvent()`/`@OnCriticalEvent()`-decorated method needs real review when this
transport lands, not a mechanical rename. `BrokerDomainEventEmitter` is a
stub — a real implementation is warranted only once a concrete signal (a
second deployed service, a real cross-service integration) makes it
necessary, and it has real design work to resolve first, not just "swap the
transport":

- **`emitCritical()`'s contract is transport-dependent.** In-process, the
  listener runs inside the caller's transaction, so a throw rolls the triggering
  operation back. Across a broker the subscriber is in another process — that
  guarantee is physically impossible. Model 2 has to offer a weaker, explicit
  substitute (transactional outbox, at-least-once delivery, idempotent
  consumers), and this interface's doc must be updated to say so.
- **Payload deserialization.** The publish side is already handled — the
  `DomainEvent` contract requires JSON-safe payloads and
  `assertDomainEventSerializable()` enforces it in every event's spec. The
  consume side still needs a reviver (`occurredAt` returns as a string) and, if
  handlers rely on the event being a real class instance, an event-name -> class
  registry.
- **Subscription model — the real cost, not just a wiring swap.**
  `@OnEvent()`/`@OnCriticalEvent()` + `DiscoveryService` only exists because
  everything runs in one process on one `EventEmitter2` instance. A broker
  consumer isn't "the same decorator pointed at a different bus" — every
  listener needs review, because the guarantees genuinely change underneath
  it, not just where the call comes from:
  - **No transactional rollback.** A broker subscriber runs in another
    process at another time — there is no way for its failure to reach back
    and roll back the producer's already-committed transaction, unlike
    `emitCritical()`'s in-process guarantee today (see the bullet above).
  - **At-least-once delivery.** The same message can be redelivered (retries,
    consumer-group rebalances). A listener written assuming "this runs
    exactly once" — true in-process by construction — must become idempotent,
    or it will double-process on redelivery.
  - **Ack/offset semantics.** A broker consumer decides when to commit an
    offset, usually after successful processing, so a crash before ack
    replays the message. `@OnEvent()`'s current contract (a void/async
    method NestJS logs-and-swallows a failure from by default) has no
    equivalent — the listener has to participate in that lifecycle somehow.

  A facade decorator that looks the same across both transports would hide
  all three of these rather than surface them, which is worse than the gap
  being visible. See "Keep the decorated method a thin dispatcher" above for
  what to do about this *today*, without building a false abstraction.
- **Which events cross the boundary.** Not every in-process event should be
  published to a broker; that selection is a design decision, not a default.
- **Topic/queue naming across applications.** `DOMAIN_EVENTS_APPLICATION_ID` (see
  "Application identity" above) is the seam for this — the intended shape is
  `${application}.${eventName}` as the topic/queue name, or `application`
  stamped into the message envelope/headers if the broker favors one topic per
  event type with many producers.

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
  DOMAIN_EVENTS_APPLICATION_ID, // only if a provider you add opts into injecting it
} from '@/ascendra-commons/domain-events';
```

Wire it once at the composition root:

```typescript
@Module({
  imports: [DomainEventsModule.forRoot()], // transport: 'in-process' is the default; no application needed here
})
export class AppModule {}
```

Then inject `DOMAIN_EVENT_EMITTER` wherever business logic raises events (see the
`DomainEventEmitter` section above for the constructor shape).
