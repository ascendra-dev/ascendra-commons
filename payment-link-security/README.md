# Payment Link Security Pattern

A payer, typically with no account at all, receives a link and pays. That
link is a public URL, reachable by anyone who has it, with no login in front
of it. This pattern defines how such a link identifies exactly one resource
to exactly one subject, without an account, a password, or a session — and,
critically, without inventing a second access-control mechanism alongside
whatever tenant/actor-isolation convention the consuming project already has
(`multi-tenancy`, in the Ascendra Pay case this was promoted from).

No dependency on any other pattern in this library — self-contained.
`resourceId`/`subjectId` are opaque strings; this module never depends on a
project's own domain types (Invoice, Payer). **The concrete business logic
that touches those types — deciding when a link is generated or revoked —
stays project-owned**; only the generic token mechanics and its observability
are vendored here.

There is a real Model 1/Model 2-shaped seam in the stack adapter (a `.core`
port with one Postgres implementation today), plus a genuine observability
surface (2026-09-12) — so this is a container of dot-named packages:

| Package | Role | Depends on |
|---|---|---|
| **`payment-link-security.core`** | `PaymentLinkTokenService` port, `TokenResolutionRecorder` port + `NoopTokenResolutionRecorder`, `TokenResolutionObservabilityPort`, `PaymentLinkSecurityModule.forRoot({ serviceToken, imports })`. **No implementation.** | `@nestjs/common` |
| **`payment-link-security.core.postgres-drizzle`** | `PostgresPaymentLinkTokenService` (hashed-token table), `PostgresTokenResolutionRecorder`, `PostgresTokenResolutionObservabilityService`; schema + migration. | `payment-link-security.core`, `drizzle-orm`, `node:crypto` |
| **`payment-link-security.api`** | Read-only HTTP endpoints over the observability port — resolution log, trace, outcome counts. | `payment-link-security.core`, `authorization.core` |

Dependency direction is one-way toward `.core`.

## The core insight: a validated token feeds the consumer's own access-control branch — it doesn't bypass it

An anonymous visitor has no session, no tenant context, nothing an ordinary
authorization/RLS layer would recognize — a naive query would correctly
return nothing. The fix is not a bypass; it's using the token to *establish*
exactly the identity that access-control layer already expects for the
duration of one request. In the project this pattern was promoted from
(Ascendra Pay), that means feeding `resolve()`'s result into the exact same
payer-scoped RLS branch an authenticated payer session already uses — see
that project's own `multi-tenancy-pattern.md`. This module doesn't build or
depend on that branch itself; it only supplies the identity that flows into it.

## Never a raw token at rest or in a log

Tokens are cryptographically random (`crypto.randomBytes(32)`), never
sequential or derived from `resourceId`/`subjectId` in a guessable way — and,
as of the Postgres adapter, **hashed before storage**, the same posture a
password gets. `generate()` is the only place the raw value exists outside the
caller's own request.

## Token validity — governed by the resource's own state, not a separate timer

A payment link can legitimately be used weeks after it's sent, unlike a
password-reset link. `revoke()` is called when the underlying resource becomes
non-payable — defense in depth alongside whatever payment-creation logic
already refuses payment against a non-payable resource regardless.

## Observability (2026-09-12)

**The gap this closes:** a `resolve()` miss — unknown, guessed, or revoked
token — previously returned `404` (or `null`) and vanished with zero trace.
That's exactly the enumeration/brute-force signal this pattern's own threat
model names as a real risk (strong token entropy makes brute-forcing
computationally infeasible *on its own*; rate limiting and this observability
are both defense in depth on top of that, not proof it's unnecessary).

`resolve()` now records one `TokenResolutionAttempt` per call — `resolved` /
`not_found` / `revoked` — through the optional `TokenResolutionRecorder`
port, best-effort and guarded exactly like `domain-events`' delivery
recorder: a logging failure never changes what `resolve()` returns to the
caller. `not_found` and `revoked` are deliberately indistinguishable to the
*caller* (both just get `null` — never a hint that a similar token might
exist) but distinguishable in the log, so an ops screen can tell "routine
stale-link clicks" from "someone is actively guessing tokens."

Never the raw token in the log either — see "Never a raw token" above; the
resolution log stores the same hash the token table does.

## Consuming this module

Copy `payment-link-security/payment-link-security.core/` +
`payment-link-security/payment-link-security.core.postgres-drizzle/` into
`src/ascendra-commons/payment-link-security/`; add `.api` if you want the
admin read surface.
