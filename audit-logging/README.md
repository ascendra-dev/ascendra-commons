# Audit Logging Pattern

## Overview

An immutable record of "who did what, to what, when" — distinct from
application/ops logs (debugging) and from notifications (informing users).
Two related but distinct concepts stay explicitly separate: the **audit log**
(compliance-grade, immutable, append-only) and an **activity feed** (a
human-readable UI timeline), which is a *view derived from* the audit log,
never a second system.

This pattern depends on `domain-events/` also being vendored — `emitCritical()`
and `@OnCriticalEvent()` are what make "a dropped audit record is unacceptable"
a real, enforced guarantee rather than a documentation claim. Copy both
folders together.

Built and audited against `MODULE-STANDARD.md` (this repo's root). No
`applicationId` used today — but unlike most other modules here, this is the
one where it's a *plausible near-term* ask, not a hypothetical one:
centralized cross-product compliance reporting ("every admin action across
every Ascendra product, this quarter") is a standard, real request. Still
correctly N/A for now, with no concrete signal behind it — flagged here as the
module to watch. If that story lands, `APPLICATION_ID` needs no new token or
interface change: this module already depends on `domain-events`, which
already defines the token — the consumer just needs to supply `application` to
its own `DomainEventsModule.forRoot()` call (optional under `'in-process'`,
see that module's README) so it's actually bound, and then
`persistAuditRecord()` (or the consumer's own repository) can
`@Inject(APPLICATION_ID)` directly. `tenantId` *is* already threaded — see
`AuditableDomainEvent` below.

## The pieces

### `AuditableDomainEvent` — how an arbitrary event describes itself as an audit record

```typescript
export interface AuditableDomainEvent extends DomainEvent {
  toAuditRecord(): {
    entityType: string;
    entityId: string;
    tenantId: string | null;
    actor: string;
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason?: string | null;
  };
}
```

Extends `DomainEvent` (not a separate `occurredAt` field here) specifically
so the audit record's timestamp is the moment the business fact happened, not
the moment the audit write happened to run — `DomainEvent.occurredAt`'s own
doc comment already names this as the reason that field exists on every
domain event, not just auditable ones.

Feature code never constructs an `AuditEvent` directly — it raises a domain
event whose payload already carries the facts of what changed, and the event
maps itself to an audit record here, so nothing downstream grows a
per-entity-type switch statement as new auditable events are added.

`tenantId: string | null` — not every audited event has a single tenant (a
platform-level change, e.g. an admin redefining a role's permissions in a
platform-owned catalog, has none) — mirrors an `Actor`'s own `tenantId`
nullability in the authorization pattern, for the same reason.

### `persistAuditRecord()` — the one piece of real logic this pattern ships

```typescript
export async function persistAuditRecord(auditRepo: AuditEventRepository, event: AuditableDomainEvent): Promise<void> {
  const record = event.toAuditRecord();
  await auditRepo.insert({
    ...record,
    reason: record.reason ?? null,
    correlationId: getCurrentCorrelationId(),
    occurredAt: event.occurredAt,
  });
}
```

Deliberately a plain function, not a shipped listener class. Which specific
event names get audited is project-specific (invoice/payment domain in one
project, something else entirely elsewhere) — this library cannot ship a
pre-wired `@OnCriticalEvent()`-decorated class without baking someone else's
event names into it. See "Consuming this module" below for the small class
the consumer writes themselves.

### Correlation id — `AsyncLocalStorage`, not a request-scoped provider

```typescript
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T;
export function getCurrentCorrelationId(): string; // never undefined — generates a fresh id if no context was ever established
```

A request-scoped NestJS provider only exists inside an actual HTTP request's
DI context — a background job (`background-jobs` pattern) has no request at
all, the same fact that already ruled out a request-scoped `TenantContext`
there. `AsyncLocalStorage` follows the async call chain itself regardless of
where that chain started, so the same mechanism works for both triggers.

`CorrelationIdMiddleware` wires this once per HTTP request, reusing an
inbound `x-correlation-id` header if present (letting a correlation id span
multiple services) or generating a fresh one. For a background job, the job's
own wiring class should call `runWithCorrelationId()` once per **run** — not
leave it to `getCurrentCorrelationId()`'s per-call fallback, which would give
every item in a batch its own unrelated id instead of one id tying the whole
run's audit records together:

```typescript
@Cron('0 8 * * *')
async scheduledRun() {
  await runWithCorrelationId(randomUUID(), () => this.runner.run(this.job));
}
```

### `AuditEventRepository` — the persistence port

```typescript
export interface AuditEventRepository {
  insert(record: AuditEventInput): Promise<void>; // AuditEventInput = Omit<AuditEvent, 'id'> — the repository assigns id
}
```

No `update`/`delete` — audit records are write-once by construction of the
interface, not just by convention.

## Consuming this module

Copy `audit-logging/` **and** `domain-events/` into the consumer's
`src/ascendra-commons/` (see `module-packaging-pattern.md`), wire the module:

```typescript
@Module({
  imports: [
    DomainEventsModule.forRoot(), // required — this pattern's listener is reached via emitCritical(); application isn't needed here (see "Application identity" above)
    AuditLoggingModule.forRoot({
      auditEventRepositoryToken: AUDIT_EVENT_REPOSITORY_IMPL, // whatever token the app's own repository is provided under
      imports: [AuditModule],                                  // whatever module exports that token
    }),
  ],
})
export class AppModule {}
```

Then write the one small class this pattern doesn't ship for you — real event
names are the only project-specific part:

```typescript
@Injectable()
export class AuditListener {
  constructor(@Inject(AUDIT_EVENT_REPOSITORY) private readonly auditRepo: AuditEventRepository) {}

  @OnCriticalEvent('invoice.status_changed')
  @OnCriticalEvent('payment.confirmed')
  @OnCriticalEvent('workflow.step_approved')
  @OnCriticalEvent('invoice.reminder_due')
  async handle(event: AuditableDomainEvent) {
    await persistAuditRecord(this.auditRepo, event);
  }
}
```

`@OnCriticalEvent()`, never plain `@OnEvent()` — the default `suppressErrors: true`
would silently swallow a failed `insert()` instead of propagating it, which
is the one guarantee this whole pattern exists to provide.

### Worked example: mapping a real event

```typescript
export class InvoiceStatusChanged implements AuditableDomainEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly tenantId: string,
    public readonly previousStatus: string,
    public readonly newStatus: string,
    public readonly changedBy: string,
    public readonly occurredAt: Date,
  ) {}

  toAuditRecord() {
    return {
      entityType: 'invoice',
      entityId: this.invoiceId,
      tenantId: this.tenantId,
      actor: this.changedBy,
      action: 'status_changed',
      before: { status: this.previousStatus },
      after: { status: this.newStatus },
    };
  }
}

// Publisher side — inside the same db.transaction() as the state change:
await this.events.emitCritical('invoice.status_changed',
  new InvoiceStatusChanged(invoiceId, tenantId, previousStatus, 'paid', actorId, new Date()));
// Not caught here: letting emitCritical()'s rejection propagate out of the
// transaction callback is what rolls the state change back. To commit anyway
// on an audit failure, the publisher would catch it deliberately — its call.
```

`emitCritical()`, not `emit()` — genuinely awaited, so a thrown audit failure
propagates back to the publisher, which by not catching it lets the transaction
callback roll the state change back too. The audit `INSERT` itself still runs on
`AuditEventRepository`'s own connection, not the caller's transaction handle
— `EventEmitter2` has no way to carry one through without leaking a
Drizzle-specific handle into every other subscriber of the same event
(a notification listener has no business receiving one). Accepted as an MVP
tradeoff: the realistic failure mode is narrow and non-catastrophic — an
audit trail is compliance record-keeping, not the payment ledger itself. If
this ever causes a real incident, the fix is an `AsyncLocalStorage`-based
ambient-transaction mechanism, the same idea this pattern already uses for
correlation ids — not built speculatively here.

## Model 1 — Event-Driven Capture, Indefinite Retention (current)

What's shipped: `AuditEvent`, `AuditableDomainEvent`, `AuditEventRepository`,
`persistAuditRecord()`, the correlation-id mechanism, and
`AuditLoggingModule.forRoot()`. No listener class (project-specific, see
above), no retention/purge policy (audit records are kept indefinitely,
an explicit decision given the financial nature of the data, not a silent
default), no admin UI for browsing records, and — worth being explicit about,
since the Overview names an activity-feed concept — **no read/query API at
all**: `AuditEventRepository` is write-only by construction (`insert()` only,
see "The pieces" above). A consumer needing to read audit records back today
has to query its own audit table directly, outside this module's own
interface. See below for the deferred design, not built.

### Not built: reading audit records — a real Model 1 extension, not Model 2

Recorded so it isn't lost, not built speculatively — same treatment
`background-jobs` gives its own not-yet-built `JobRunRecorder`. The design,
when a real activity-feed or compliance-export story asks for it:

```typescript
export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  tenantId?: string | null;
  actor?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  limit?: number;
  cursor?: string; // opaque, from a previous page's result
}

export interface AuditQueryResult {
  records: AuditEvent[];
  nextCursor?: string; // present only if more records exist
}
```

Added as `AuditEventRepository.find(query: AuditQuery): Promise<AuditQueryResult>`
— on the existing interface, not a new one, since it's the same persistence
port, just a second capability on it. This does not weaken "audit records are
write-once by construction" (the README's own claim for the interface today):
`find()` reads, never mutates or deletes, so the write-once guarantee holds
exactly as before. An "activity feed" (per the Overview's own distinction) is
then a thin UI layer calling `find()` and rendering the result — never a
second system with its own storage.

## Model 2 — Broader Coverage (future target)

Same `AuditEvent` shape and `persistAuditRecord()` mechanism — only the set
of entities/actions the consumer's own listener subscribes to grows, as
genuine compliance or operational need appears. No new mechanism required;
this is why the data model was kept generic from the start.
