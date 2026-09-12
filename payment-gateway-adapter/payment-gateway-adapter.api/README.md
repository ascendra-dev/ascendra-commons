# `payment-gateway-adapter.api` — HTTP read endpoints for a webhook security/ops screen

Opt-in NestJS controller over `WEBHOOK_OBSERVABILITY_PORT`. Stack-agnostic.
**Read-only** — events are write-once, recorded only by a `WebhookEventLog`
implementation. Webhook handling itself, and the concrete gateway adapters
(`ManualPaymentAdapter`, `{GatewayName}Adapter`), stay in the vertical's own
code — they touch project-specific domain types (Invoice, Payment) this
module never depends on.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/payment-gateway/webhook-events` | `listEvents(WebhookEventQuery)` — query params: `gateway`, `outcome`, `correlationId`, `since`, `until`, `limit`, `cursor`. Returns `WebhookEventPage` (newest-first + `nextCursor`) unchanged. |
| GET | `/payment-gateway/webhook-events/trace/:correlationId` | every webhook event from one request — a cross-module trace. |
| GET | `/payment-gateway/webhook-events/catalog` | counts by outcome (optionally windowed) — a spike in `signature_invalid` or `ignored_backwards` is worth investigating, not silently absorbed. |

All gated on `@RequiresAction('payment-gateway.view')`. No tenant scoping.

## Why this exists

The webhook endpoint is the most security-critical path in a payments
system — a request claiming money arrived. Before this, three things it does
correctly (dedup a redelivery, reject an invalid signature, ignore an
out-of-order event) all happened silently, with no trace anywhere that any of
them had occurred. `ignored_backwards` in particular mirrors exactly the
`late_complete_no_op_count` gap `idempotency-key` closed this same session —
a correct-but-silent no-op that's also the one signal worth knowing about.

## Wiring

```typescript
import { PaymentGatewayApiModule } from '.../payment-gateway-adapter.api';
import { PostgresWebhookObservabilityModule } from '.../payment-gateway-adapter.core.postgres-drizzle';

@Module({
  imports: [
    PaymentGatewayApiModule.forRoot({
      imports: [PostgresWebhookObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`payment-gateway-adapter.core` (the port + DTOs), and `authorization.core`
(guard, `@RequiresAction`). Never a stack adapter. The frontend belongs in
`ascendra-commons-ui`.
