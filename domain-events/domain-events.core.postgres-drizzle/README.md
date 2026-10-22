# `domain-events.core.postgres-drizzle` — the delivery-log Postgres/Drizzle adapter

Two library-owned statements over `commons_domain_events_delivery`:

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `recorder/` | `EventDeliveryRecorder` — buffered in memory (no I/O on the emit), written every `flushIntervalMs` (10s) as multi-row `INSERT`s, one row per delivery, `application` stamped; flushed on shutdown | `EVENT_DELIVERY_RECORDER` (core token) | `InProcessDomainEventEmitterModule.forRoot({ recorderToken })` |
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

## The recorder buffers

`emitCritical()` awaits the recorder, inside every producer's own request — so the recorder never does I/O there.
Deliveries go into an in-memory buffer and are written every `flushIntervalMs` (default 10s); `maxBufferedRows`
(default 10,000) caps it between flushes, and anything past it is dropped and counted in the next flush's log. A failed
flush is logged with how many deliveries it lost and never retried; a crash loses up to one interval. Call
`app.enableShutdownHooks()` so the buffer is written on deploy. Rows appear up to one interval late.

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
