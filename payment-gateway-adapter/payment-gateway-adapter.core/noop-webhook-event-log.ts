import type { PaymentGatewayStatus } from './payment-gateway-adapter.port';
import type { WebhookEventLog } from './webhook-event-log.port';

/**
 * The default binding when no stack adapter is configured. **Not safe for
 * production use as the dedup mechanism itself** — every `claim()` call
 * reports `'applied'`, so it provides no actual deduplication; it exists so
 * `handleWebhook()` call sites compile and run in a project that hasn't
 * wired persistence yet, the same "inert until configured" role every other
 * `Noop*` in this library plays. A real deployment needs a real
 * `WebhookEventLog` (e.g. `PostgresWebhookEventLog`).
 */
export class NoopWebhookEventLog implements WebhookEventLog {
  async claim(
    _gateway: string,
    _gatewayReference: string,
    _status: PaymentGatewayStatus,
    _correlationId?: string,
  ): Promise<'applied' | 'duplicate'> {
    return 'applied';
  }

  async recordRejectedEvent(): Promise<void> {
    // intentionally inert
  }
}
