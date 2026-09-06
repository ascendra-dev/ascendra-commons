# `idempotency-key.core.postgres-drizzle` — Model 1

The atomic claim over a `commons_idempotency_key` table.

## Layout

| File | |
|---|---|
| `persistence/idempotency-key.schema.ts` | Drizzle `pgTable` — source of truth for the columns |
| `persistence/idempotency-key.migration.sql` | the same table as hand-kept DDL + the `created_at` index — **keep in sync** |
| `persistence/sql-executor.ts` | the minimal db shape (`{ rows }` only) |
| `postgres-idempotency-store.ts` | `IdempotencyStore` — `claim()` / `complete()` |
| `postgres-idempotency-store.module.ts` | `forRoot({ sqlExecutorToken, staleAfterSeconds, imports })` → `POSTGRES_IDEMPOTENCY_STORE` |

## The claim

`claim()` is **one** `INSERT … ON CONFLICT DO UPDATE … WHERE (status='pending' AND created_at < now()-stale) … RETURNING claim_id`:

- **fresh key** → inserts, one row → `{ claimed, claimId }`
- **stale abandoned claim** → the `WHERE` matches, updates (new `claim_id`, `created_at`), one row → `{ claimed, claimId }`
- **recent pending / completed** → the `WHERE` doesn't match, zero rows → a fallback `SELECT` classifies it `in_progress` / `completed`
- **row deleted mid-race** (a cleanup job) → a race-safe `INSERT … ON CONFLICT DO NOTHING RETURNING` re-claim (never a plain `INSERT` that could PK-violate under a concurrent re-claim)

`rows.length` is the "did I win" check, not `rowCount` — `RETURNING` guarantees
the rows array, and `rowCount` isn't reliably populated across `pg` /
`postgres.js` for `ON CONFLICT` statements.

## `claim_id` — the ownership guard

Every claim carries a fresh `claim_id`. `complete(key, scope, claimId, response)`
is guarded `WHERE claim_id = $claimId`. So if a still-in-flight claim is
reclaimed as stale (`claimId` overwritten by the new owner), the original
claimer's eventual `complete()` is a **silent 0-row no-op** — it can't write its
response over the current owner's cached one.

This does **not** stop the duplicate side-effect — once a live claim is reclaimed
by time, both requests run, and nothing at this layer can prevent that. Set
`staleAfterSeconds` above the real p99 of the slowest enforced endpoint (`forRoot`
throws on `<= 0`). The guard just keeps the cache consistent with what the
current owner's client actually saw.

## Cleanup

A bare `@Cron()` handler in the consuming project:
`DELETE FROM commons_idempotency_key WHERE created_at < now() - interval '24 hours'`
— safe under concurrent execution (Postgres serializes it; no `IdempotentJobRunner`
needed). The `commons_idempotency_key_created_at_idx` index keeps that off a full
scan. **Note:** this 24h *completed-record* expiry is a separate number from
`staleAfterSeconds` (the *pending-claim* abandonment window) — don't conflate them.

## Depends on

`idempotency-key.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
