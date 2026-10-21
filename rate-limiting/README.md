# Rate Limiting Pattern

Once any endpoint is public or low-friction — a payment link, most
concretely — something has to bound how often it can be hit, as defense in
depth alongside token entropy. This pattern defines that mechanism without
adding operational infrastructure a single-instance deployment doesn't need.

No dependency on any other pattern in this library — self-contained (it's
referenced by `payment-link-security`'s own README as a defense-in-depth
partner, but neither module imports the other). The seam already exists —
`@nestjs/throttler`'s own `ThrottlerStorage` interface — so there's no
project-defined port to add on top of it; a Redis-backed `ThrottlerStorage`
is a drop-in swap once horizontally scaled, entirely inside that library.

There **is** a genuine observability surface (2026-09-12), so this is a
container of dot-named packages:

| Package | Role | Depends on |
|---|---|---|
| **`rate-limiting.core`** | `RateLimitEventRecorder` port + `NoopRateLimitEventRecorder`, `RateLimitObservabilityPort`. Generic — no `@nestjs/throttler` dependency at all. | `@nestjs/common` |
| **`rate-limiting.core.throttler`** | `RecordingThrottlerGuard` — a drop-in `ThrottlerGuard` subclass that records every rejection through the optional recorder. The one concrete throttling integration; no other library is in play. | `rate-limiting.core`, `@nestjs/throttler` |
| **`rate-limiting.core.postgres-drizzle`** | `PostgresRateLimitEventRecorder`, `PostgresRateLimitObservabilityService`; schema + migration. | `rate-limiting.core`, `drizzle-orm` |
| **`rate-limiting.api`** | Read-only HTTP endpoints over the observability port — rejection log, trace, per-route counts. | `rate-limiting.core`, `authorization.core` |

Dependency direction is one-way toward `.core`.

## Declared the same way authorization is

```typescript
@Get('pay/:token')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
async resolvePaymentLink(@Param('token') token: string) { /* ... */ }
```

Unchanged from `@nestjs/throttler` itself — one line at the endpoint, not
custom logic per handler. This library adds nothing to that declaration; the
seam is `@Throttle()`/`ThrottlerStorage` as-is.

## Who the "caller" is — the tracker

`@nestjs/throttler` counts per *tracker*: `req.ip` by default. Two things decide
whether that is right:

- **Behind a reverse proxy or load balancer, set Express's `trust proxy`.**
  Without it `req.ip` is the proxy's own address, so every caller shares one
  counter — one busy user throttles everyone, and the rejection log names the
  proxy instead of the source. Set it to the number of proxies in front of the
  app (`app.set('trust proxy', 1)` behind one load balancer) — never `true`,
  which trusts a client-supplied `X-Forwarded-For` and lets an attacker pick a
  fresh "IP" per request.
- **A signed-in route can count per user instead.** Subclass
  `RecordingThrottlerGuard` and override `getTracker()` (e.g. return the actor
  id, falling back to the IP) — the rejection log then records that identifier.

The recorded identifier is personal data (an IP, or a user id). It is kept raw
on purpose — ops need the real address to block it upstream and to match it
against `payment-link-security`'s log — so bound how long it is kept (below).

## Defense in depth — the gateway in front

This module is not a replacement for edge limiting. A reverse proxy, CDN or
gateway (nginx `limit_req`, a WAF) should carry coarse per-IP limits that drop a
volumetric flood before it reaches Node; `@Throttle()` carries the limits only
the app can express — per route, per user, per payment token — and the rejection
log shows what got past the edge.

## Model 1 — in-memory, single instance (current)

`@nestjs/throttler`'s built-in in-memory storage — correct for a single
deployed instance (counts are tracked per-process, which is exactly right
when there is only one process). No Redis, no additional infrastructure.

## Model 2 — distributed storage (future target)

A Redis-backed `ThrottlerStorage`, sharing counts across every instance once
horizontally scaled. Same `@Throttle()` declarations; only the storage
backend changes. Build only once a second instance actually exists.

## Observability (2026-09-12)

**The gap this closes:** a `429` used to vanish with no trace anywhere. If a
public, unauthenticated endpoint is actually being hammered — the exact
threat this pattern exists to defend against — nothing told you it was
happening.

`RecordingThrottlerGuard` (in `.core.throttler`) reports every `429` —
route pattern, resolved identifier (typically an IP), the limit/ttl that was
exceeded — through the optional `RateLimitEventRecorder` port, best-effort and
guarded: a logging failure never changes whether the request is actually
throttled.

**A flood must not become database load (2026-10-21).** The rejection log is
needed most exactly when a route is being hammered, so recording can't cost a
write per blocked request — that would move the attack from the handler onto
Postgres. The Postgres recorder counts rejections in memory (no I/O on the
`429` path) and upserts them every 10s as one row per route, identifier,
limit, minute and correlation id: write volume follows the number of distinct
sources, not the request rate, and several instances upsert into the same
rows. Past 10,000 distinct sources between flushes, new ones are counted under
an `(overflow)` identifier per route, so route totals stay exact. Up to one
flush interval can be lost if the process dies — acceptable for a best-effort
log. Hooked at
`ThrottlerGuard.throwThrottlingException()`, the one method the library
itself designed to be overridden — not a separate `ExceptionFilter`, which
couldn't see the limit/tracker detail that method has.

Cross-reference `rate-limiting.api`'s rejection log against
`payment-link-security.api`'s resolution log for the same window — a source
hitting both is a strong enumeration signal, not two unrelated blips.

## Retention

`commons_rate_limit_rejection` grows with the number of distinct sources per
minute, and is never pruned on its own — retention is the consumer's
(MODULE-STANDARD dimension 7). `rate-limiting.core.postgres-drizzle` ships
`PostgresRateLimitRetentionService.pruneRejections(before)`, a batched,
`application`-scoped delete; call it from the project's own scheduler (a
`background-jobs` `ScheduledJob` daily, keeping e.g. 90 days). This module
takes no dependency on `background-jobs` itself.

## Consuming this module

`node ascendra-commons.js add rate-limiting.core.throttler` (brings
`rate-limiting.core` with it); add `rate-limiting.core.postgres-drizzle` +
`rate-limiting.api` if you want the recorded log and its admin read surface.
