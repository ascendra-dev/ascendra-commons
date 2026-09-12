# `payment-link-security.api` — HTTP read endpoints for a security/ops screen

Opt-in NestJS controller over `TOKEN_RESOLUTION_OBSERVABILITY_PORT`.
Stack-agnostic — never imports a stack adapter; wired to one at the vertical
via `imports`. **Read-only** — resolution attempts are write-once, so there's
no mutation surface. Token `generate()`/`revoke()` stay in the vertical's own
controllers (they're driven by project-specific events — an invoice created,
voided, or paid), not shipped here.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/payment-links/resolutions` | `listAttempts(ResolutionQuery)` — query params: `outcome`, `correlationId`, `since`, `until`, `limit`, `cursor`. Returns `ResolutionPage` (newest-first + `nextCursor`) unchanged. |
| GET | `/payment-links/resolutions/trace/:correlationId` | every resolution attempt from one request — a cross-module trace. |
| GET | `/payment-links/resolutions/catalog` | counts by outcome (optionally windowed by `since`) — a spike in `not_found` is the enumeration/brute-force signal. |

All gated on `@RequiresAction('payment-link.view')`. No tenant scoping — a
resolution attempt happens *before* any identity is established (that's the
entire point of `resolve()`), so there's nothing to scope by; grant the
action to an ops/security persona.

## Why this exists

A `resolve()` miss (unknown, guessed, or revoked token) previously returned
`404` and vanished with no trace anywhere — exactly the enumeration-attack
signal `rate-limiting`'s own 429s are meant to defend against, but with
nothing telling you whether it's actually happening. This module is the
corresponding read surface — not a replacement for rate limiting, its
observability counterpart.

## Wiring

```typescript
import { PaymentLinkApiModule } from '.../payment-link-security.api';
import { PostgresTokenResolutionObservabilityModule } from '.../payment-link-security.core.postgres-drizzle';

@Module({
  imports: [
    PaymentLinkApiModule.forRoot({
      imports: [PostgresTokenResolutionObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`payment-link-security.core` (the port + DTOs), and `authorization.core`
(guard, `@RequiresAction`). Never a stack adapter. The frontend belongs in
`ascendra-commons-ui`.
