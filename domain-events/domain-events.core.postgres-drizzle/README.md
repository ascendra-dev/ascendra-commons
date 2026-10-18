# `domain-events.core.postgres-drizzle` — the delivery-log Postgres/Drizzle adapter

Two library-owned statements over `commons_domain_events_delivery`:

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `recorder/` | `EventDeliveryRecorder` — one `INSERT` per `emit()`/`emitCritical()` call, `application` stamped | `EVENT_DELIVERY_RECORDER` (core token) | `InProcessDomainEventEmitterModule.forRoot({ recorderToken })` |
| `observability/` | `EventDeliveryObservabilityPort` — one dynamic `SELECT`, keyset-paginated, plus one aggregate query, both `application`-scoped | `EVENT_DELIVERY_OBSERVABILITY_PORT` (core token) | `PostgresEventDeliveryObservabilityModule.forRoot(...)` |
| `persistence/domain-event-delivery.schema.ts` | the table's current shape — change it with the `INSERT`/`SELECT` | | |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file | | |

There is no family package — both ports and all DTOs are stack-agnostic and
live in `domain-events.core`; the keyset-cursor helper is there too. A project
on another stack implements those two core ports and ignores this folder.

**Delivery only, never a listener outcome** — see `domain-events.core`'s
README, "What this does and doesn't observe," before reaching for this table
to answer "did the notification send" or "did the audit write succeed." It
doesn't; that's `notification`'s and `audit-logging`'s own observability.

There is no Postgres implementation of `EventListenerCatalogPort` here — that
port has no persistence at all (it's a live read of decorator metadata) and is
provided directly by `domain-events.core.in-process`; nothing to wire in this
package for it.

## Wiring

Tables: apply `migrations/` (`ascendra-commons.js` delivers them into your migrations) with your own migration tool — never re-export the schema tables to `drizzle-kit` too, or it generates them a second time (MODULE-STANDARD dimension 7). **Requires PostgreSQL 15+** (`filter (where ...)` in `deliveryCatalog()`'s aggregate query).

```typescript
DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [
    InProcessDomainEventEmitterModule.forRoot({
      recorderToken: POSTGRES_EVENT_DELIVERY_RECORDER,
      imports: [PostgresEventDeliveryRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
  ],
}),
// for an event-delivery admin screen (independent — import either or both):
PostgresEventDeliveryObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

## `application`

Stamped on insert and filtered on every read (`application = $1`), so an app's
own delivery-log screen sees only its own rows.

## Retention

Not addressed here — this is an operational trace, not a compliance record
(contrast `audit-logging`'s indefinite retention). A consumer that wants a
retention window prunes `commons_domain_events_delivery` with its own
`ScheduledJob`, the same shape `background-jobs`' own `job-run-pruner.job.ts`
uses for `commons_jobs_job_run`.

## Depends on

`domain-events.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
