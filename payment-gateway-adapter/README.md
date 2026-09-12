# Payment Gateway Adapter Pattern

Core payment logic must never depend on a single payment gateway or market's
payment methods directly — the seam between the Payment domain and any
concrete gateway integration, so a gateway can be swapped or added per market
without touching Invoice/Payment logic.

**Scoping note:** unlike most modules in this library, this pattern touches
genuinely project-specific domain concepts (an invoice, a payment). Only the
generic mechanics — the adapter interface, the webhook dedup/observability
plumbing — are vendored here, parameterized over opaque string ids exactly
the way `notification`'s `Notifier` never knows what an "invoice" is. The
concrete adapters (`ManualPaymentAdapter`, and any real `{GatewayName}Adapter`)
touch Invoice/Payment directly and stay project-owned — they merely
*implement* the interface shipped here.

There is a real Model 1/Model 2 seam (manual recording vs. an integrated
gateway) plus a genuine observability surface (2026-09-12) on the one part
that *is* generic — the webhook path — so this is a container of dot-named
packages:

| Package | Role | Depends on |
|---|---|---|
| **`payment-gateway-adapter.core`** | `PaymentGatewayAdapter` port, `WebhookEventLog` port (atomic dedup), `WebhookObservabilityPort`. **No implementation of the adapter itself** — that's project-owned (see above). | `@nestjs/common`, `localization-currency` (for `Money`) |
| **`payment-gateway-adapter.core.postgres-drizzle`** | `PostgresWebhookEventLog`, `PostgresWebhookObservabilityService`; schema + migration. | `payment-gateway-adapter.core`, `drizzle-orm` |
| **`payment-gateway-adapter.api`** | Read-only HTTP endpoints over the observability port — webhook event log, trace, outcome counts. | `payment-gateway-adapter.core`, `authorization.core` |

Dependency direction is one-way toward `.core`.

## Model 1 — manual payment recording (project-owned)

No external gateway integration — an issuer or admin marks an invoice paid
directly. A fully real, usable path, not a stub — proves the domain model end
to end before any gateway exists. Implemented entirely in the consuming
project (it touches Invoice/Payment); this library ships only the interface
it satisfies.

## Model 2 — integrated online gateway (project-owned, seam shipped here)

A concrete `{GatewayName}Adapter` — hosted checkout, webhook-driven status
confirmation, refunds. The generic webhook mechanics below are what this
library actually provides.

## The webhook path — hardened past the pattern's own original sketch

The webhook endpoint is arguably the most security-critical path in the
system — a request claiming money arrived.

- **Dedup is atomic, not check-then-act.** The pattern this module was
  promoted from originally showed a plain `has()` then `record()` pair — two
  concurrent deliveries of the same event could both pass `has()` before
  either called `record()`. `WebhookEventLog.claim()` closes that race the
  same way `idempotency-key`'s own store does: one atomic
  `INSERT … ON CONFLICT DO NOTHING RETURNING`, not two calls.
- **Keyed by `(gateway, gatewayReference, status)`**, not `gatewayReference`
  alone — a gateway legitimately sends more than one status transition for
  the same reference over its lifetime (`pending` → `succeeded` → possibly
  `refunded`); each transition applies once, a redelivery of the *same*
  transition no-ops.
- **Signature verification** happens inside each concrete
  `{GatewayName}Adapter.handleWebhook()`, against the *raw* request body
  bytes — never a re-parsed JSON object (re-serializing can silently break
  verification, even with identical field values). An invalid signature
  throws and is never processed; call `WebhookEventLog.recordRejectedEvent()`
  with outcome `'signature_invalid'` so it isn't silently invisible.
- **Delivery order is not guaranteed.** A stale `pending` event can arrive
  after a `succeeded` one was already processed. Deciding what counts as
  "backwards" is a project-level business decision this module doesn't make
  (it depends on the project's own status semantics) — but once decided,
  call `recordRejectedEvent()` with outcome `'ignored_backwards'` so an
  out-of-order event is visible, not silently dropped.

## Observability (2026-09-12)

**The gap this closes:** dedup, signature rejection, and out-of-order
handling were all documented as things the webhook path does *correctly* —
but doing the right thing silently, with zero trace, on the system's most
security-critical path, is itself a gap. `ignored_backwards` in particular
mirrors `idempotency-key`'s own `late_complete_no_op_count` finding from this
same session: a correct-but-silent no-op is also the one signal worth
knowing about, not an afterthought.

`WebhookEventLog` now writes every outcome — `applied`, `duplicate`,
`ignored_backwards`, `signature_invalid` — to a full trail
(`commons_payment_gateway_webhook_event`), separate from the narrow atomic
dedup ledger `claim()` itself needs. `payment-gateway-adapter.api` ships the
read surface.

## Consuming this module

Copy `payment-gateway-adapter/payment-gateway-adapter.core/` +
`payment-gateway-adapter/payment-gateway-adapter.core.postgres-drizzle/` into
`src/ascendra-commons/payment-gateway-adapter/`; add `.api` for the admin read
surface. Write your own `ManualPaymentAdapter` / `{GatewayName}Adapter` in
your own `src/modules/payments/` — they implement `PaymentGatewayAdapter`,
they don't live here.
