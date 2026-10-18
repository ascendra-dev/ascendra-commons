# `payment-gateway-adapter.core.postgres-drizzle` — the Postgres/Drizzle adapter

Two tables: an atomic dedup ledger, and the full observability trail.

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `webhook/` | `WebhookEventLog` — `claim()` (atomic dedup) + `recordRejectedEvent()` | `WEBHOOK_EVENT_LOG` (core token) | `PostgresWebhookEventLogModule.forRoot(...)` |
| `observability/` | `WebhookObservabilityPort` — `listEvents()` / `outcomeCounts()`, read-only | `WEBHOOK_OBSERVABILITY_PORT` (core token) | `PostgresWebhookObservabilityModule.forRoot(...)` |
| `persistence/*.schema.ts` | the tables' current shape | | |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file | | |

No family package — both core ports are stack-agnostic and live in
`payment-gateway-adapter.core`. A project on another stack implements those
and ignores this folder.

## Two tables, two different shapes, on purpose

`commons_payment_gateway_webhook_claim` — a narrow ledger, one row per
`(application, gateway, gateway_reference, status)` ever claimed, existing
purely so `claim()`'s `INSERT … ON CONFLICT DO NOTHING RETURNING` has
something atomic to conflict against. Not queried directly by any read path.

`commons_payment_gateway_webhook_event` — the full trail, one row per webhook
attempt *regardless of outcome*, including the two kinds `claim()` never
sees (`ignored_backwards`, `signature_invalid`). This is what
`payment-gateway-adapter.api` reads.

## Wiring

Tables: apply `migrations/` through your project's own migration tool — never re-export the schema tables to `drizzle-kit` too, or it generates them a second time (MODULE-STANDARD dimension 7).

```typescript
PostgresWebhookEventLogModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
// for a security/ops read screen (independent — import if wanted):
PostgresWebhookObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

`PostgresWebhookEventLogModule` binds `WEBHOOK_EVENT_LOG` directly — no
separate `forRoot({ storeToken })` wiring module the way `idempotency-key`
needs, since there's exactly one Postgres implementation, not several
implementations to choose between.

## `application`

Stamped on every row, filtered on by every read.

## Retention

Not addressed here — this is an operational/security trace, not a compliance
record. A consumer that wants a retention window prunes both tables with its
own scheduled job.

## Depends on

`payment-gateway-adapter.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
