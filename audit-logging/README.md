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
`AuditRecordRaised` below.

## The pieces

### `AuditRecordRaised` — the one event this pattern's listener reacts to

```typescript
export class AuditRecordRaised implements DomainEvent {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly tenantId: string | null,
    public readonly actor: string,
    public readonly action: string,
    public readonly before: Record<string, unknown> | null,
    public readonly after: Record<string, unknown> | null,
    public readonly occurredAt: Date,
    public readonly reason: string | null = null,
  ) {}
}

export const AUDIT_EVENT_NAME = 'audit.record_raised'; // one fixed name, exported, never project-specific
```

Feature code raises this **explicitly**, alongside (or instead of) whatever
business-named event other listeners care about — it never derives "is this
worth auditing" from some other event's shape. This replaces an earlier
design where a business event class (e.g. `InvoiceStatusChanged`) implemented
a `toAuditRecord()` method, and a project-authored listener subscribed to
that event's own name. That coupled "is this audited" to two
separately-maintained facts with nothing enforcing they agreed: the event
class implementing the interface, and the listener's own subscription list
naming that event. Forgetting the second one meant an event that looked
audit-ready silently wasn't — no error anywhere.

Making the audit event's name **one fixed, library-defined constant** removes
that coupling, and removes something else along with it: since the name is
never project-specific, this library can ship the one listener that reacts to
it (`AuditListener`, below) instead of asking every consumer to hand-write
one. Whether something is audited is now answered by exactly one fact,
visible at the call site — did the producer construct and emit an
`AuditRecordRaised` — not by cross-referencing two files that have no
structural reason to know about each other.

Extends `DomainEvent` (not a separate `occurredAt` field) for the same reason
the older design did: the audit record's timestamp is the moment the
business fact happened, not the moment the audit write happened to run —
`DomainEvent.occurredAt`'s own doc comment already names this as the reason
that field exists on every domain event.

`tenantId: string | null` — not every audited event has a single tenant (a
platform-level change, e.g. an admin redefining a role's permissions in a
platform-owned catalog, has none) — mirrors an `Actor`'s own `tenantId`
nullability in the authorization pattern, for the same reason.

**`action` is verb-only, not full `resource.verb` dot-notation** — deliberately,
not an oversight against `MODULE-STANDARD.md` dimension 9. `entityType` and
`action` together already express the resource+verb pair (`'invoice'` +
`'status_changed'`); repeating the resource inside `action` itself
(`action: 'invoice.status_changed'`) would duplicate `entityType` for no
benefit. Dimension 9 governs string keys a module hands a consumer to *define
and match on* independently (a notification type, a domain event name); an
`AuditEvent`'s `action` is always read back out alongside its own `entityType`
in the same row, never matched against in isolation, so the two-column split
is the more honest shape here, not a deviation worth chasing into one string.
`AUDIT_EVENT_NAME` itself, and any business event names raised alongside it,
do follow the dot-notation convention — it's specifically `AuditEvent.action`
that doesn't, and can't without becoming redundant with `entityType`.

### `persistAuditRecord()` — the one piece of real logic this pattern ships

```typescript
export async function persistAuditRecord(auditRepo: AuditEventRepository, event: AuditRecordRaised): Promise<void> {
  await auditRepo.insert({
    entityType: event.entityType,
    entityId: event.entityId,
    tenantId: event.tenantId,
    actor: event.actor,
    action: event.action,
    before: event.before,
    after: event.after,
    reason: event.reason,
    correlationId: getCurrentCorrelationId(),
    occurredAt: event.occurredAt,
  });
}
```

No mapping step — `AuditRecordRaised` already carries every field
`AuditEventInput` needs except `correlationId` (ambient, see below). The older
design needed this function to call the event's own `toAuditRecord()`; that
translation layer is gone along with the interface it translated from.

### `AuditListener` — shipped, not consumer-authored

```typescript
@Injectable()
export class AuditListener {
  constructor(@Inject(AUDIT_EVENT_REPOSITORY) private readonly auditRepo: AuditEventRepository) {}

  @OnCriticalEvent(AUDIT_EVENT_NAME)
  async handle(event: AuditRecordRaised) {
    await persistAuditRecord(this.auditRepo, event);
  }
}
```

`AuditLoggingModule.forRoot()` registers this as one of its own providers —
see "Consuming this module" below. Nothing about wiring this up is
project-specific, because `AUDIT_EVENT_NAME` isn't: there is exactly one
listener, always subscribed to the same one name, regardless of how many
different kinds of entities a project ends up auditing.

`handle()` is a thin dispatcher by construction, not by discipline — it
*cannot* grow real logic, because there is only one thing to do with any
`AuditRecordRaised` regardless of what raised it. This is the reference
example `domain-events`' README cites by name in its "Keep the decorated
method a thin dispatcher" section. Worth knowing in both directions: if this
method ever needs branching logic per entity type, that's a sign the model
has outgrown "one generic audit record, one generic listener," not something
to add here.

`@OnCriticalEvent()`, never plain `@OnEvent()` — the default `suppressErrors: true`
would silently swallow a failed `insert()` instead of propagating it, which
is the one guarantee this whole pattern exists to provide.

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
  insert(record: AuditEventInput): Promise<void>;
}
```

`AuditEventInput` is a `Pick<>` of `AuditRecordRaised`'s own fields, plus
`correlationId` (added by `persistAuditRecord()` at persist time, from
ambient context — see below). Deriving it this way, rather than hand-declaring
the same fields twice, means the two shapes can't quietly drift apart.
`AuditEvent` is `AuditEventInput` plus `id` — the persistence layer assigns
that on insert, so it can't be part of what a caller supplies.

No `update`/`delete` — audit records are write-once by construction of the
interface, not just by convention.

### A worked schema example

This library ships no schema at all today, unlike `notification`'s
`NotificationChannelConfig`/`NotificationTemplateRepository` README examples —
worth a concrete worked example here specifically because `audit-logging` is
already the module flagged above as "the one to watch" for `applicationId`,
and there was nothing for that guidance to land on. The table is generic
enough to be shareable the same way those two are (see `MODULE-STANDARD.md`
dimension 7): every column maps directly off `AuditEvent`, and the consuming
project owns the actual database/connection/migration.

```typescript
// In the consuming project, not in this library:
export const auditEventTable = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  tenantId: text('tenant_id'), // nullable — platform-level events have none
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  correlationId: text('correlation_id').notNull(),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at').notNull(),
  // Passive metadata, populated at insert, never queried — see the note below.
  applicationId: text('application_id').notNull(),
}, (table) => ({
  byEntity: index('audit_event_entity_idx').on(table.entityType, table.entityId),
  byTenantAndTime: index('audit_event_tenant_time_idx').on(table.tenantId, table.occurredAt),
}));

class DrizzleAuditEventRepository implements AuditEventRepository {
  constructor(
    private readonly db: SomeLooselyTypedDrizzleDb,
    @Inject(APPLICATION_ID) private readonly applicationId: string, // see the note below
  ) {}

  async insert(record: AuditEventInput): Promise<void> {
    await this.db.insert(auditEventTable).values({ ...record, applicationId: this.applicationId });
  }
}
```

The two indexes above aren't speculative — they're exactly what the
not-yet-built `AuditQuery` shape needs (`entityType`+`entityId` for "this
record's history," `tenantId`+`occurredAfter`/`occurredBefore` for "this
tenant's activity feed, recent first"), so they're cheap to add now, before
any real row exists, rather than as a later migration once `find()` actually
gets built.

**`application_id` is stamped on insert here, never a parameter `insert()`
itself takes.** Same reasoning `notification`'s README already gives for
`notificationChannelConfigTable`/`notificationTemplateTable` (see
`MODULE-STANDARD.md` dimension 4): free to add now, before the table exists,
and it's the one module in this repo where a future consolidation (the
cross-product compliance-reporting story named above) is a genuinely plausible
reason to ever read it back. `APPLICATION_ID` is already available to inject
here — no new token — since this module already depends on `domain-events`,
which defines it (see the Overview above); it's provided in the same module as
`DrizzleAuditEventRepository` itself, for the identical per-module DI-scoping
reason `notification`'s README spells out for its own database-backed
examples.

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

Nothing more to write — `AuditListener` is already registered by
`AuditLoggingModule.forRoot()` above. Auditing an entity is done entirely from
the producer side: raise an `AuditRecordRaised` under `AUDIT_EVENT_NAME`
wherever a state change should be audited.

### Worked example: raising an audit record alongside a business event

```typescript
// InvoiceStatusChanged is an ordinary DomainEvent (domain-events pattern) —
// nothing about it relates to auditing. Its only readers are whatever other
// listeners (e.g. notification) subscribe to 'invoice.status_changed'.
export class InvoiceStatusChanged implements DomainEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly tenantId: string,
    public readonly actorId: string,
    public readonly occurredAt: Date,
  ) {}
}

// Publisher side — inside the same db.transaction() as the state change:

// Optional — only if some other listener (e.g. notification) actually cares
// about this business fact. A lean payload: no before/after snapshots, since
// nothing here needs them.
await this.events.emit('invoice.status_changed',
  new InvoiceStatusChanged(invoiceId, tenantId, actorId, new Date()));

// Always, for auditing — richer payload (explicit before/after), constructed
// right where the old/new values are already in scope:
await this.events.emitCritical(AUDIT_EVENT_NAME,
  new AuditRecordRaised(
    'invoice', invoiceId, tenantId, actorId, 'status_changed',
    { status: previousStatus }, { status: 'paid' }, new Date(),
  ));
// Not caught here: letting emitCritical()'s rejection propagate out of the
// transaction callback is what rolls the state change back. To commit anyway
// on an audit failure, the publisher would catch it deliberately — its call.
```

Two separate emits for one state change is the honest cost of this design —
see "`AuditRecordRaised`" above for why it's a better trade than the two-file,
uncompiled coupling it replaces. If nothing besides auditing
cares about a given state change, the first `emit()` is simply skipped —
there's no need to invent a business event name nobody else listens to just
to have somewhere to hang an audit record off of.

`emitCritical()`, not `emit()`, for the audit event specifically — genuinely
awaited, so a thrown audit failure propagates back to the publisher, which by
not catching it lets the transaction callback roll the state change back too.
The audit `INSERT` itself still runs on `AuditEventRepository`'s own
connection, not the caller's transaction handle — `EventEmitter2` has no way
to carry one through without leaking a Drizzle-specific handle into every
other subscriber of the same event (a notification listener has no business
receiving one). Accepted as an MVP tradeoff: the realistic failure mode is
narrow and non-catastrophic — an audit trail is compliance record-keeping,
not the payment ledger itself. If this ever causes a real incident, the fix
is an `AsyncLocalStorage`-based ambient-transaction mechanism, the same idea
this pattern already uses for correlation ids — not built speculatively here.

## Model 1 — Event-Driven Capture, Indefinite Retention (current)

What's shipped: `AuditEvent`, `AuditRecordRaised`, `AuditEventRepository`,
`persistAuditRecord()`, `AuditListener` (registered automatically by
`AuditLoggingModule.forRoot()` — no project-specific listener to write, see
above), the correlation-id mechanism. No retention/purge policy (audit records
are kept indefinitely,
an explicit decision given the financial nature of the data, not a silent
default), no admin UI for browsing records, and — worth being explicit about,
since the Overview names an activity-feed concept — **no read/query API at
all**: `AuditEventRepository` is write-only by construction (`insert()` only,
see "The pieces" above). A consumer needing to read audit records back today
has to query its own audit table directly, outside this module's own
interface. See below for the deferred design, not built.

### Not built: reading audit records — a real Model 1 extension, not Model 2

**Scored against `MODULE-STANDARD.md` dimension 8's end-user/admin split**
(introduced after this module's own Audit 1 pass, so restated here explicitly):
**end-user UI contract is N/A** — an audit trail has no per-record
show/hide/enable concern reaching a tenant's own user the way `authorization`'s
`computeActionAvailability` or `notification`'s delivery status does; nobody's
own audit history is something they show/hide for themselves in this
pattern's scope. What follows is squarely the **administration**-UI side
(compliance/ops staff browsing or exporting records) — appropriately a
prose-only, not-built sketch, downstream of the query API below not existing
yet, the same treatment `authorization`'s own admin-UI paragraph gets for its
unbuilt Model 2 (see that module's review in `MODULE-STANDARD-AUDIT.md`).

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

**Not built either: the API and web pieces a real admin UI needs, once `find()`
exists.** Neither ships from `ascendra-commons` itself — this library is
backend-pattern-only, same as `authorization`'s own admin UI, which stays a
paragraph here rather than shipped code until a frontend counterpart library
(`ascendra-commons-ui`) exists. The shape, for when a real compliance/ops
story asks for it:

- **API module**, in the consuming project — one endpoint (e.g.
  `GET /admin/audit-events`), self-contained the same way `authorization`'s
  `AuthorizationApiModule` is: gated by `can()` on a dedicated action (e.g.
  `'audit.view'`, following the `resource.verb` convention — restricted to a
  compliance/platform-admin persona, never a tenant user), accepting query
  params that map directly onto `AuditQuery`, and returning `AuditQueryResult`
  as-is — no transformation needed, since `records`/`nextCursor` is already
  UI-shaped.
- **Web module**, in the consuming project's frontend — an admin-only route
  with a filter form matching `AuditQuery`'s fields and a cursor-paginated
  table. The nav entry to it uses the same `computeActionAvailability`-style
  hide/show `authorization` already provides elsewhere, gated on the same
  `'audit.view'` action, so someone without permission doesn't see the menu
  item at all, not just get a 403 from the API.

## Model 2 — Broader Coverage (future target)

Same `AuditRecordRaised` shape, same `AuditListener`, same `persistAuditRecord()`
mechanism — growing coverage means only that more call sites raise
`AuditRecordRaised`, as genuine compliance or operational need appears. No new
mechanism required, and — unlike the older per-event-name subscription
design — no second file to update either: there's no listener subscription
list to grow, since `AuditListener` already reacts to every `AuditRecordRaised`
regardless of which entity or action it describes.

**Correlation id has the same ambient-context-can't-cross-a-process-boundary
problem `domain-events`' README names for `tenantId`** (see its "Explicit on
the event, never derived from ambient context" section) — same underlying
cause, different conclusion. `AsyncLocalStorage` context lives only within
one unbroken async call chain in one process; `getCurrentCorrelationId()`
works correctly today only because `domain-events`' current in-process
dispatch keeps the HTTP request (or job run) and the listener on that one
chain. Under a broker transport (`domain-events`' own Model 2), the listener
runs in a separate consumer process with no ancestry back to the producer's
`AsyncLocalStorage` context — `getCurrentCorrelationId()` wouldn't throw or
read stale data, it would silently fall back to generating a fresh, unrelated
id, quietly breaking "ties every audit record from one request together"
with no error anywhere. Unlike `tenantId`, the fix isn't "read it off the
event's own field instead of context" — a correlation id is a cross-cutting
execution identifier, not a fact about the entity being audited, so it has no
natural home on every event's business payload. The fix, when a broker
transport actually lands: carry the correlation id explicitly in the
broker message's own envelope/headers (most broker clients support message
metadata for exactly this), and have the consumer call
`runWithCorrelationId()` once per message — reestablishing the context
explicitly in the new process from that carried value, never left to the
ambient fallback to paper over its absence. Not built — no broker transport
exists yet — recorded here so it isn't lost when that lands.
