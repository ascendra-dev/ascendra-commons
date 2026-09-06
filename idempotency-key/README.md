# Idempotency Key Pattern

## Overview

Protects against the *same* request being retried — a payer double-clicking
"Pay," a network retry resubmitting an unchanged request. Distinct from
optimistic locking, which protects against a *different* request racing
against stale data. A duplicate payment submission is a real, plausible
failure mode any project moving money must not leave to chance.

No dependency on any other pattern in this library — self-contained.

Built and audited against `MODULE-STANDARD.md` (this repo's root). No
`applicationId` anywhere — deliberately N/A, an idempotency claim never leaves
the process/database it's made in. No separate `tenantId` field either, but
not because tenancy is unhandled: `scope` (below) already carries whatever
identifies the acting tenant/actor, and is more flexible than a bare
`tenantId` would be — it's resolver-supplied, so it can be a tenant id, an
actor id, or a signed-link token's own identity for an anonymous caller,
whichever the enforced endpoint actually needs.

## The pieces

### `IdempotencyStore` — an atomic claim, not check-then-act

```typescript
export interface CachedResponse { statusCode: number; body: unknown; }

export type ClaimResult =
  | { status: 'claimed' }
  | { status: 'completed'; response: CachedResponse }
  | { status: 'in_progress' };

export interface IdempotencyStore {
  claim(key: string, scope: string): Promise<ClaimResult>;
  complete(key: string, scope: string, response: CachedResponse): Promise<void>;
}
```

A plain `get()` then `save()` is not safe, even against one shared table:
two requests carrying the same key arriving close together can both see
"nothing cached yet" before either has written its own entry. The claim
itself has to be atomic at the database level — see `PostgresIdempotencyStore`.

`scope` is the acting tenant/actor id, not just the raw key, so one tenant's
key can never collide with another's.

### `IdempotencyScopeResolver` — pluggable, because not every enforced endpoint has an `Actor`

```typescript
export interface IdempotencyScopeResolver {
  resolveScope(request: unknown): Promise<string>;
}
```

An anonymous caller following a signed link (a payment link, most
concretely) has no `Actor` at all. `ActorScopeResolver` is the default for
the authenticated case; an endpoint reachable anonymously needs its own
resolver deriving scope from whatever *does* identify the request in that
case — designing that mechanism is a project-specific concern (a payment
link's own security pattern), not this one's. `resolveScope` returns
`Promise<string>`, not `string` — an anonymous-case resolver will plausibly
need to validate a token against a database, which is inherently async;
keeping the interface async from the start means that's a drop-in
implementation later, not a breaking change.

### `IdempotencyInterceptor` — enforcement, not a per-handler check

```typescript
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  async intercept(context, next) {
    const key = request.headers['idempotency-key'];
    if (!key) return next.handle();

    const scope = await this.scopeResolver.resolveScope(request);
    const claim = await this.store.claim(key, scope);

    if (claim.status === 'completed') {
      const { statusCode, body } = claim.response;
      return statusCode >= 400 ? throwError(() => new HttpException(body, statusCode)) : of(body);
    }
    if (claim.status === 'in_progress') throw new ConflictException();

    const statusCode = /* @HttpCode() metadata, else 201 for POST / 200 otherwise */;
    return next.handle().pipe(
      switchMap((body) => from(this.store.complete(key, scope, { statusCode, body })).pipe(map(() => body))),
      catchError((err) => /* cache a definitive HttpException, rethrow either way */),
    );
  }
}
```

Three things worth being deliberate about, each one a real bug in an
earlier draft of this pattern:

- **The cached status code is captured, never hardcoded.** Every endpoint
  this pattern is meant for is a `POST` that plausibly returns `201` — a
  cached response claiming `200` would simply be wrong on replay.
- **A cached error replays as that same error**, via a reconstructed
  `HttpException`, not silently reported as a success carrying the error's
  body.
- **The response isn't emitted until `complete()`'s write has actually
  landed** (`switchMap`, not `tap` — `tap`'s callback isn't awaited). Without
  this, a client could receive a success response before the cache write
  lands, and a fast-arriving retry in that window would see the row still
  `'pending'` and get a wrong `409` instead of the correct cached response.

**Only a definitive `HttpException` is cached and replayed on failure** — a
business-rule rejection, a validation error. An unexpected or transient
error (a raw throw, a timeout) is not: a retry re-attempting the operation
is more likely correct than replaying a possibly-spurious failure forever
until the claim goes stale.

A `409` on `in_progress` is deliberate: the interceptor never blocks a
request waiting for another one to finish — it fails fast. The frontend is
expected to have the submit control disabled while the first attempt is in
flight anyway; this is a safety net for the case that discipline doesn't
catch, not the primary defense.

### `PostgresIdempotencyStore` — the atomic claim, and its one real number

```sql
create table commons_idempotency_key (
  key text not null,
  scope text not null,
  status text not null default 'pending',
  status_code int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (key, scope)
);
```

The claim is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING`
statement — atomic regardless of which server node issues it, the guarantee
coming from Postgres's own conflict handling on the `(key, scope)` primary
key, not in-process coordination.

```typescript
export interface IdempotencyStoreOptions {
  staleAfterSeconds: number; // no safe default — see below
}
```

**There is no safe universal default for `staleAfterSeconds`.** It's how
long a `'pending'` claim sits before a later request may treat it as
abandoned and reclaim it. Set it too low and a request that's still
genuinely in flight — most plausibly one waiting on a payment gateway's own
API — gets reclaimed and re-run *concurrently with itself*: the exact
duplicate this whole pattern exists to prevent, reintroduced by the safety
mechanism itself. Measure the slowest endpoint this is actually applied to
before choosing a number; never copy one from a different project's
different endpoints.

A row that fails to claim, then vanishes before the fallback read (a
cleanup job, most plausibly) is handled by re-inserting fresh — not by
reporting `'claimed'` without ever having written the row, which would
leave nothing for a real concurrent duplicate to be caught against.

## Model 1 — Postgres-Backed, Explicit Endpoint List (current)

What's shipped: `IdempotencyStore`, `IdempotencyScopeResolver`,
`ActorScopeResolver`, `PostgresIdempotencyStore`, `IdempotencyInterceptor`,
and `IdempotencyModule.forRoot()`. No global enforcement, no admin UI — a
plain table and one interceptor, applied by explicit inclusion via
`@UseInterceptors(IdempotencyInterceptor)` on exactly the endpoints where a
duplicate is genuinely costly, never by default.

**Cleanup is a bare `@Cron()` handler, not `background-jobs`'s
`IdempotentJobRunner`.** A bulk `DELETE FROM commons_idempotency_key WHERE created_at < now() - interval '24 hours'`
is already safe under concurrent execution by construction — two instances
issuing it at once is redundant, not harmful, and Postgres serializes it
correctly on its own. `IdempotentJobRunner`'s lock and per-item isolation
exist to prevent duplicate *concurrent processing of the same item*, which
a bulk statement has nothing of. Reaching for it anyway would be real,
unneeded machinery. This 24-hour expiry is a separate number from
`staleAfterSeconds` and must not be confused with it — one governs when a
*completed* record is safe to discard, the other when a still-*pending*
claim is safe to assume abandoned.

## Model 2 — Broader Coverage / Redis-Backed (future target)

Expanded endpoint coverage if further non-repeat-safe operations are
identified, and/or a Redis-backed store if the Postgres table's volume
becomes a genuine performance concern. Same interceptor and interface
either way — only the endpoint list and/or the `IdempotencyStore`
implementation change.

## Consuming this module

```typescript
@Module({
  imports: [
    IdempotencyModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION, // whatever token the app's own Drizzle db is already provided under
      staleAfterSeconds: 45,                 // measured from this project's real endpoint latencies, not copied
      // scopeResolverToken: PAYMENT_LINK_SCOPE_RESOLVER, // only if an enforced endpoint is reachable anonymously
      imports: [DatabaseModule],
    }),
  ],
})
export class AppModule {}
```

```typescript
@Post('invoices')
@UseInterceptors(IdempotencyInterceptor)
async createInvoice(@Body() dto: CreateInvoiceDto) { /* ... */ }
```
