# Idempotency Key Pattern

Protects against the *same* request being retried — a payer double-clicking
"Pay," a network retry resubmitting an unchanged request. Distinct from
optimistic locking (which protects against a *different* request racing stale
data). A duplicate payment submission is a real failure mode any project moving
money must not leave to chance.

No dependency on any other pattern in this library — self-contained.

There is a real Model 1 / Model 2 seam — the store backend — so the module is a
container of dot-named packages, the same shape as `domain-events`:

| Package | Role | Depends on |
|---|---|---|
| **`idempotency-key.core`** | `IdempotencyStore` port, `IdempotencyObservabilityPort`, `IdempotencyScopeResolver` port + `ActorScopeResolver`, `IdempotencyInterceptor`, the `ClaimResult`/`CachedResponse`/`IdempotencyStoreOptions` types, `IdempotencyModule.forRoot({ storeToken, scopeResolverToken?, imports })`. **No store.** | `@nestjs/common`, `@nestjs/core`, `rxjs` |
| **`idempotency-key.core.postgres-drizzle`** (Model 1) | `PostgresIdempotencyStore` — one atomic `INSERT … ON CONFLICT …` claim; `PostgresIdempotencyObservabilityService` — read-only claim lookup + health summary; schema + migration; `forRoot({ sqlExecutorToken, staleAfterSeconds })`. | `idempotency-key.core`, `drizzle-orm` |
| **`idempotency-key.core.redis`** (Model 2) | `RedisIdempotencyStore` — a stub that throws `RedisIdempotencyStoreNotImplementedError`. The seam is real; the store isn't built. | `idempotency-key.core` |
| **`idempotency-key.api`** (2026-09-12) | Read-only HTTP endpoints over `IdempotencyObservabilityPort` — claim lookup, filtered list, correlation trace, health summary. No admin surface (claims are written only by `IdempotencyStore`). | `idempotency-key.core`, `authorization.core` |

Dependency direction is one-way toward `.core`.

## Wiring

```typescript
IdempotencyModule.forRoot({
  storeToken: POSTGRES_IDEMPOTENCY_STORE,
  imports: [
    PostgresIdempotencyStoreModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      staleAfterSeconds: 45,   // measured from THIS project's slowest enforced endpoint's real p99, never copied
      imports: [DatabaseModule],
    }),
  ],
})
```

```typescript
@Post('invoices')
@UseInterceptors(IdempotencyInterceptor)   // opt in per-endpoint, only where a duplicate is genuinely costly
async createInvoice(@Body() dto: CreateInvoiceDto) { /* ... */ }
```

## The pieces (in `idempotency-key.core`)

- **`IdempotencyStore`** — `claim(key, scope, context?)` → `claimed` / `completed` /
  `in_progress`; `complete(key, scope, claimId, response)`. An **atomic** claim
  — a plain `get()` then `save()` races.
- **`ClaimResult.claimId`** — an ownership token the interceptor threads into
  `complete()`. A claim reclaimed as stale (its `claimId` overwritten) can't
  write its response over the new owner's cache — see the adapter README.
- **`IdempotencyScopeResolver` + `ActorScopeResolver`** — `scope` = the acting
  tenant/actor id, so one tenant's key can't collide with another's.
  `ActorScopeResolver` (reads `request.actor`) is the default; an
  anonymously-reachable endpoint (a signed payment link) needs its own resolver.
- **`IdempotencyInterceptor`** — reads the `Idempotency-Key` header, claims,
  caches the handler's **real** status code (never hardcoded), replays a cached
  error *as* that error, and only emits the response after `complete()`'s write
  lands. A `409` on `in_progress` — it fails fast, never blocks.

## `applicationId` / `tenantId`

No `applicationId` — a claim never leaves the store. No `tenantId` field —
`scope` already carries whatever identifies the requester.

## Model 1 — Postgres (current)

A `commons_idempotency_key` table (schema + migration ship in the adapter — see
its README), one atomic claim, and the `claim_id` ownership guard. Cleanup is a
bare `@Cron()` `DELETE` in the consuming project — safe under concurrent
execution, no `IdempotentJobRunner` needed. The 24h completed-record expiry is a
**separate number** from `staleAfterSeconds` (the pending-claim abandonment
window) — don't conflate them.

## Model 2 — Redis (seam in place, store not built)

A Redis-backed store if the Postgres table's volume becomes a genuine
performance concern. Same interceptor and port. See
`idempotency-key.core.redis`'s README for the design (`SET NX PX` claim,
`staleAfterSeconds` → key TTL, a short second TTL on the completed response, a
Lua `claimId` compare-and-set).

## Observability (2026-09-12)

Scoped narrower than a browsable claim log — **delivery only, never a listener
outcome**, the same posture `domain-events` observability takes: was a claim
fresh or a reclaim, and did a `complete()` call get silently dropped. Both were
previously invisible even querying the raw table — see `idempotency-key.core`'s
README, "Observability," for why that mattered more than the usual "nice to
have a dashboard" case. `idempotency-key.api` ships the read surface;
`idempotency-key.core.postgres-drizzle` ships the reference implementation.

**2026-10-21 — what the pattern absorbs, and where.** The failures were
counted, the successes weren't: a repeat request answered with the saved
response (a *replay*) or turned away with a `409` while the first was still
running (a *conflict*) left no trace. Both are now counted per claim
(`replayCount`, `conflictCount`, `lastDuplicateAt`) — in memory on the request,
added to the row every 10s, so a client hammering one key costs no extra write
per request (the standard rate-limiting set). Each claim also records its
endpoint's **route pattern** (`/payments/:id`, never the URL), so the health
numbers break down per endpoint (`GET /idempotency-keys/routes`) and take a
period (`?since=`). History reaches back as far as claims are retained (24h by
default) — this is a short-lived safety store, not a log.
