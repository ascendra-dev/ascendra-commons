# `payment-link-security.core.postgres-drizzle` — the Postgres/Drizzle adapter

Two tables: the token store and the resolution log.

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `service/` | `PaymentLinkTokenService` — `generate()`/`resolve()`/`revoke()` over a hashed-token table | `POSTGRES_PAYMENT_LINK_TOKEN_SERVICE` | `PaymentLinkSecurityModule.forRoot({ serviceToken })` |
| `recorder/` | `TokenResolutionRecorder` — one `INSERT` per `resolve()` call | `TOKEN_RESOLUTION_RECORDER` (core token) | `PostgresPaymentLinkTokenServiceModule.forRoot({ recorderToken })` |
| `observability/` | `TokenResolutionObservabilityPort` — `listAttempts()` / `outcomeCounts()`, read-only | `TOKEN_RESOLUTION_OBSERVABILITY_PORT` (core token) | `PostgresTokenResolutionObservabilityModule.forRoot(...)` |
| `hash-token.ts` | The one place a raw token becomes a storable/loggable value (SHA-256) | — | used internally by both `service/` and `recorder/` |
| `persistence/*.schema.ts` | the tables' current shape | | |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file | | |

No family package — both core ports (`PaymentLinkTokenService`, the recorder,
and the observability port) are stack-agnostic and live in
`payment-link-security.core`. A project on another stack implements those and
ignores this folder.

## Never a raw token at rest or in a log

`commons_payment_link_token.token_hash` and
`commons_payment_link_resolution.token_hash` both store a SHA-256 digest, never
the raw token — the same posture a password gets. `generate()` is the only
place the raw value ever exists outside the caller's own request — it's
returned once, for the caller to embed in the link URL, and never touches
storage or a log again. A leaked table row never hands back a usable link.

## Wiring

Tables: apply `migrations/` through your project's own migration tool — never re-export the schema tables to `drizzle-kit` too, or it generates them a second time (MODULE-STANDARD dimension 7).

```typescript
PaymentLinkSecurityModule.forRoot({
  serviceToken: POSTGRES_PAYMENT_LINK_TOKEN_SERVICE,
  imports: [
    PostgresPaymentLinkTokenServiceModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay',
      recorderToken: POSTGRES_TOKEN_RESOLUTION_RECORDER,   // optional — omit for no resolution log at all
      imports: [DatabaseModule, PostgresTokenResolutionRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
  ],
}),
// for a security/ops read screen (independent — import if wanted):
PostgresTokenResolutionObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

## `application`

Stamped on every row, filtered on by every read — an app's own security
screen sees only its own rows.

## Retention

Not addressed here — this is an operational/security trace, not a compliance
record. A consumer that wants a retention window prunes
`commons_payment_link_resolution` with its own scheduled job, the same shape
`background-jobs`' own pruner uses elsewhere in this library. Token rows
(`commons_payment_link_token`) should generally be kept — a revoked token's
row is itself useful history for "why did this stop working."

## Depends on

`payment-link-security.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`), `node:crypto`.
