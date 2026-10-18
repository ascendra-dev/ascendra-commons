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

`RecordingThrottlerGuard` (in `.core.throttler`) records one
`RateLimitRejection` per `429` — route pattern, resolved identifier
(typically an IP), the limit/ttl that was exceeded — through the optional
`RateLimitEventRecorder` port, best-effort and guarded: a logging failure
never changes whether the request is actually throttled. Hooked at
`ThrottlerGuard.throwThrottlingException()`, the one method the library
itself designed to be overridden — not a separate `ExceptionFilter`, which
couldn't see the limit/tracker detail that method has.

Cross-reference `rate-limiting.api`'s rejection log against
`payment-link-security.api`'s resolution log for the same window — a source
hitting both is a strong enumeration signal, not two unrelated blips.

## Consuming this module

`node ascendra-commons.js add rate-limiting.core.throttler` (brings
`rate-limiting.core` with it); add `rate-limiting.core.postgres-drizzle` +
`rate-limiting.api` if you want the recorded log and its admin read surface.
