# `rate-limiting.core.postgres-drizzle` — the Postgres/Drizzle adapter

One table, one write path, one read path.

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `recorder/` | `RateLimitEventRecorder` — one `INSERT` per rejection | `RATE_LIMIT_EVENT_RECORDER` (core token) | `RateLimitingThrottlerModule.forRoot({ recorderToken })` |
| `observability/` | `RateLimitObservabilityPort` — `listRejections()` / `rejectionCatalog()`, read-only | `RATE_LIMIT_OBSERVABILITY_PORT` (core token) | `PostgresRateLimitObservabilityModule.forRoot(...)` |
| `persistence/rate-limit-rejection.schema.ts` + `.migration.sql` | the reference table — **keep in sync** | | |

No family package — both core ports are stack-agnostic and live in
`rate-limiting.core`. A project on another stack implements those and ignores
this folder.

## Wiring

```typescript
export * from 'src/ascendra-commons/rate-limiting/rate-limiting.core.postgres-drizzle';   // for drizzle-kit
```

…or copy `persistence/rate-limit-rejection.migration.sql`.

```typescript
RateLimitingThrottlerModule.forRoot({
  recorderToken: POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  imports: [
    PostgresRateLimitEventRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
  ],
}),
// for a security/ops read screen (independent — import if wanted):
PostgresRateLimitObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

## `application`

Stamped on every row, filtered on by every read.

## Retention

Not addressed here — this is an operational/security trace. A consumer that
wants a retention window prunes `commons_rate_limit_rejection` with its own
scheduled job, the same shape `background-jobs`' own pruner uses elsewhere.

## Depends on

`rate-limiting.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
