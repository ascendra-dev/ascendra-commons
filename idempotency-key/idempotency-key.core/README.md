# `idempotency-key.core` — the port + enforcement

Protects against the *same* request being retried — a payer double-clicking
"Pay," a network retry resubmitting an unchanged request. Distinct from
optimistic locking (which protects against a *different* request racing stale
data).

There is a real Model 1 / Model 2 seam — the store backend — so each is its own
package:

- **`idempotency-key.core.postgres-drizzle`** (Model 1) — `PostgresIdempotencyStore`:
  a `commons_idempotency_key` table, one atomic `INSERT … ON CONFLICT …` claim.
- **`idempotency-key.core.redis`** (Model 2) — a stub that throws
  `RedisIdempotencyStoreNotImplementedError`; the seam is real, the transport
  isn't built.

## What's in here

| Piece | Purpose |
|---|---|
| `IdempotencyStore` (`idempotency-store.port.ts`) | `claim(key, scope)` → `claimed` / `completed` / `in_progress`; `complete(key, scope, claimId, response)`. An **atomic** claim — check-then-act is unsafe. **No implementation here.** |
| `ClaimResult` | The `'claimed'` result carries a `claimId` — an ownership token the interceptor threads back into `complete()`, so a claim reclaimed as stale can't overwrite the new owner's cached response. |
| `IdempotencyScopeResolver` + `ActorScopeResolver` | `scope` = the acting tenant/actor id, so one tenant's key can't collide with another's. `ActorScopeResolver` (reads `request.actor`) is the default; an anonymously-reachable endpoint needs its own. |
| `IdempotencyInterceptor` | Enforcement — reads the `Idempotency-Key` header, claims, caches the handler's real status code (never hardcoded), replays a cached error *as* that error, and only emits the response after `complete()`'s write lands. |
| `IdempotencyModule.forRoot({ storeToken, scopeResolverToken?, imports })` | Pure token wiring. Does **not** apply the interceptor — the consumer opts in per-endpoint with `@UseInterceptors(IdempotencyInterceptor)`. |

## `applicationId` / `tenantId`

No `applicationId` — a claim never leaves the store it's made in. No separate
`tenantId` — `scope` already carries whatever identifies the requester (a
tenant id, an actor id, or a signed-link token's identity for an anonymous
caller), and is more flexible than a bare `tenantId` field.

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
@UseInterceptors(IdempotencyInterceptor)
async createInvoice(@Body() dto: CreateInvoiceDto) { /* ... */ }
```

## Depends on

`@nestjs/common`, `@nestjs/core`, `rxjs`. No database driver.
