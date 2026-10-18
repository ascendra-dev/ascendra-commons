# Audit Logging Pattern

An immutable record of "who did what, to what, when" — distinct from ops logs
(debugging) and notifications (informing users). An **activity feed** is a *view
derived from* the audit log, never a second system.

Unlike `authorization` / `notification`, there is **no Model 1 / Model 2 config
split** — one model: feature code raises `AuditRecordRaised`, the shipped
`AuditListener` persists it through an `AuditEventRepository` port. So the split
here is only along the delivery seams.

## The packages

| Package | Role | Depends on |
|---|---|---|
| **`audit-logging.core`** | `AuditRecordRaised` + `AUDIT_EVENT_NAME`, the shipped `AuditListener`, `persistAuditRecord`, the `AuditEventRepository` (write) and `AuditEventReader` (read) ports + DTOs, the correlation-id mechanism + middleware, the keyset-cursor helper, `AuditLoggingModule.forRoot()`. | `domain-events.core` |
| **`audit-logging.core.postgres-drizzle`** | Reference `PostgresAuditEventRepository` + `PostgresAuditEventReader`, the `pgTable` + migration, and their modules (`PostgresAuditPersistenceModule`, `PostgresAuditObservabilityModule`). A project on another stack implements the two core ports instead. | `audit-logging.core` |
| **`audit-logging.api`** | Opt-in HTTP read endpoints for a compliance / ops screen (`GET /audit/events`, `/audit/events.csv`, `/audit/events/:id`, `/audit/entities/:type/:id/history`, `/audit/trace/:correlationId`, `/audit/actors/:actor/activity`, `/audit/stats/overview`, `/audit/stats/top-actions`, `/audit/retention`, `POST /audit/coverage`), over the `AUDIT_EVENT_READER` port. Read-only. | `audit-logging.core`, `authorization.core` |

No "family" package — both ports and every DTO are genuinely stack-agnostic
contracts (a non-DB reader over an external SIEM is in scope), so they live in
`.core`; the adapter sits directly under it.

## The pieces (in `audit-logging.core`)

- **`AuditRecordRaised`** — raised **explicitly** by feature code, alongside (or
  instead of) whatever business-named event other listeners care about, always
  under the one fixed `AUDIT_EVENT_NAME`. Whether something is audited is one
  fact, visible at the call site.
- **`AuditListener`** — shipped, not consumer-authored (possible only because
  `AUDIT_EVENT_NAME` is fixed). `@OnCriticalEvent`, never plain `@OnEvent` — a
  dropped audit write must propagate, not be swallowed. A thin dispatcher by
  construction.
- **`persistAuditRecord()`** — the one piece of real logic. No mapping step
  (`AuditEventInput` is a `Pick<>` of `AuditRecordRaised`); adds `correlationId`
  from ambient context.
- **`AuditEventRepository`** (`insert()` only) — write-once by construction.
  **`AuditEventReader`** (`find(AuditQuery)`) — a **separate** port, so a custom
  write repo isn't forced to implement reads.
- **Correlation id** — `AsyncLocalStorage`, works for an HTTP request
  (`CorrelationIdMiddleware`) and a background job run alike.

## Consuming this module

`node ascendra-commons.js add` one stack adapter (`audit-logging.core.postgres-drizzle`)
and a domain-events transport (`domain-events.core.in-process`) — the transport
isn't imported, so name it — and optionally `audit-logging.api` (which needs an
authorization model too, e.g. `authorization.core.static-map`).
`audit-logging.core`, `domain-events.core` and `authorization.core` come with them.

```typescript
DomainEventsModule.forRoot({     // required — the listener is reached via emitCritical()
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
}),
AuditLoggingModule.forRoot({
  auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
  imports: [PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
}),
```

Auditing an entity is done entirely from the producer side — raise an
`AuditRecordRaised` under `AUDIT_EVENT_NAME` wherever a state change should be
audited, inside the same transaction as the change:

```typescript
await this.events.emitCritical(AUDIT_EVENT_NAME,
  new AuditRecordRaised('invoice', invoiceId, tenantId, actorId, 'status_changed',
    { status: previousStatus }, { status: 'paid' }, new Date()));
```

`emitCritical()`, not `emit()` — a thrown audit failure propagates back to the
publisher, which by not catching it lets the transaction roll the state change
back too.

**That only holds if the audit write is *in* that transaction.** The Postgres
repository writes through exactly the executor it's given (`sqlExecutorToken`) —
with a plain connection pool, the audit insert commits on its own: a change that
rolls back *after* the audit write still leaves its audit record behind, and an
audit record can't be rolled back with the change. For "a change and its audit
record commit together or not at all", the token must resolve to an executor
bound to the caller's current transaction (e.g. a request-scoped Drizzle
transaction handle). The plain pool is fine when "audit what was attempted" is
acceptable.

## `applicationId` / `tenantId`

`audit-logging` is **the module to watch** for `applicationId` — cross-product
compliance reporting ("every admin action across every Ascendra product, this
quarter") is a plausible near-term ask. The Postgres adapter already carries a
passive `application` column (stamped on insert, filtered on by the reader) so a
consolidation needs no backfill. It's returned on every `AuditEvent` (and the CSV
export) but not yet a query filter — cross-application reads, a per-application
catalog and `application`-led indexes wait for an actual consolidation
(MODULE-STANDARD §4). `action` is **verb-only**, not `resource.verb`
— `entityType` already carries the resource (deliberate; not a dimension-9
deviation).

## What's not built

- No retention/purge — audit records are kept indefinitely (explicit decision).
- No admin **UI** — `audit-logging.api` ships the read endpoints; the frontend
  is `ascendra-commons-ui`.
- Broker-transport correlation-id carry-through — see the deferred note that
  was in the old README's "Model 2" section; revisit when `domain-events` gets
  a broker transport.
