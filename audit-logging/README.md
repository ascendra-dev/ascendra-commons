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
```

`emitCritical()`, not `emit()` — genuinely awaited, so a thrown audit failure
propagates out of the transaction callback before it commits, rolling back
the state change too. The audit `INSERT` itself still runs on
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
default), no admin UI for browsing records.

## Model 2 — Broader Coverage (future target)

Same `AuditEvent` shape and `persistAuditRecord()` mechanism — only the set
of entities/actions the consumer's own listener subscribes to grows, as
genuine compliance or operational need appears. No new mechanism required;
this is why the data model was kept generic from the start.
