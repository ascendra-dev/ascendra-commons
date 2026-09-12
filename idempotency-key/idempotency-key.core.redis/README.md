# `idempotency-key.core.redis` — Model 2 (seam in place, store not built)

A Redis-backed `IdempotencyStore` — worth building only if the Postgres table's
volume becomes a genuine performance concern (a very high-throughput enforced
endpoint), not by default.

**Not built.** `RedisIdempotencyStore` throws
`RedisIdempotencyStoreNotImplementedError` on every call. The seam — this
package, the `IdempotencyStore` port in `idempotency-key.core`, the
`REDIS_IDEMPOTENCY_STORE` token — is real, so adopting Redis later is a
`forRoot()` wiring change, not a refactor of every enforced endpoint.

```typescript
IdempotencyModule.forRoot({
  storeToken: REDIS_IDEMPOTENCY_STORE,
  imports: [RedisIdempotencyStoreModule.forRoot()],
})
```

## What a real implementation resolves first

- **The atomic claim is `SET key value NX PX ttl`** (or a Lua script for the
  branching). `NX` gives the same "first writer wins" guarantee Postgres's
  `ON CONFLICT` does. The value holds `{ status: 'pending', claimId }`.
- **`staleAfterSeconds` maps onto the pending key's `PX` TTL** — when it lapses,
  the next `SET NX` succeeds and reclaims. Same semantics, same "set it above
  the slowest endpoint's real p99" rule.
- **A completed response needs a second, short TTL** — long enough to catch a
  realistic retry burst (minutes), not the 24h a Postgres row gets. On expiry a
  retry re-runs the operation; acceptable for the retry window this pattern
  targets.
- **The `claimId` guard** — `complete()` must be a compare-and-set: only
  overwrite if the stored `claimId` still matches this attempt's. A Lua script
  reads the value, checks `claimId`, and `SET`s the completed response only on a
  match — exactly what `PostgresIdempotencyStore`'s `WHERE claim_id = $` does.
  An evicted-then-slow claimer's `complete()` then no-ops instead of corrupting
  the current owner's cached response.
- **No cleanup job** — Redis TTLs handle expiry; the Postgres adapter's `@Cron`
  DELETE has no equivalent here.

## Depends on

`idempotency-key.core`, `@nestjs/common`.
