import type { Money } from '../../localization-currency';

/** `'pending'` → `'succeeded'` or `'failed'` → possibly `'refunded'`. What "backwards" means from here is a project-level decision — see `webhook-event-log.port.ts`. */
export type PaymentGatewayStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

/** A gateway event, already verified and normalized — never a gateway-specific payload shape. */
export interface PaymentGatewayEvent {
  gatewayReference: string;
  status: PaymentGatewayStatus;
  occurredAt: Date;
}

/**
 * The seam between core payment logic and any concrete gateway integration —
 * `resourceId` is opaque to this module (an invoice id, most concretely);
 * core logic depends only on this interface and on `PaymentGatewayEvent`,
 * never on a specific gateway's SDK, request/response shape, or webhook
 * payload format.
 */
export interface PaymentGatewayAdapter {
  createCheckoutSession(input: {
    resourceId: string;
    amount: Money;
    metadata: Record<string, string>;
  }): Promise<{ checkoutUrl: string; gatewayReference: string }>;

  getStatus(gatewayReference: string): Promise<PaymentGatewayStatus>;

  /** Verifies `signature` against the *raw* payload bytes internally — never a re-parsed JSON object; re-serializing can silently break verification. Throws on an invalid signature. */
  handleWebhook(rawPayload: unknown, signature: string): Promise<PaymentGatewayEvent>;

  refund(gatewayReference: string, amount?: Money): Promise<{ refundReference: string }>;
}
