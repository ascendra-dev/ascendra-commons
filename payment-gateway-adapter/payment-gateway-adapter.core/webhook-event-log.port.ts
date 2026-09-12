import type { PaymentGatewayStatus } from './payment-gateway-adapter.port';

/**
 * The dedup log a webhook controller checks before applying a gateway event.
 * **Atomic — never check-then-act.** The pattern doc this module was
 * promoted from originally showed a plain `has()` then `record()` pair; two
 * concurrent deliveries of the same event could both pass `has()` before
 * either called `record()` — the exact race `idempotency-key`'s own claim()
 * exists to close, reproduced here. `claim()` closes it the same way: one
 * atomic statement, not two.
 *
 * Keyed by `(gatewayReference, status)`, not `gatewayReference` alone — a
 * gateway legitimately sends more than one status transition for the same
 * reference over its lifetime (`pending` → `succeeded` → possibly
 * `refunded`), and each transition should be applied once, while a
 * redelivery of the *same* transition is a no-op.
 */
export interface WebhookEventLog {
  /**
   * `'applied'` the first time this exact `(gateway, gatewayReference, status)`
   * is seen — the caller should go on to apply the event. `'duplicate'`
   * every time after — a gateway redelivery; the caller should no-op (return
   * `200` without reprocessing). Records its own outcome internally,
   * best-effort — see `WebhookObservabilityPort`.
   *
   * `gateway` — which gateway partner this came from (e.g. `'stripe'`) —
   * disambiguates once more than one is integrated (per-market routing);
   * `gatewayReference` values are only unique within one gateway.
   */
  claim(
    gateway: string,
    gatewayReference: string,
    status: PaymentGatewayStatus,
    correlationId?: string,
  ): Promise<'applied' | 'duplicate'>;

  /**
   * Records an outcome that happens *outside* `claim()` — a signature that
   * failed verification (before any `gatewayReference`/`status` could be
   * trusted), or an event the caller's own logic determined would regress a
   * payment's status (delivery order is not guaranteed; a stale `pending`
   * event can arrive after a `succeeded` one was already processed — what
   * counts as "backwards" is a project-level decision this module doesn't
   * make). Best-effort — never throws.
   */
  recordRejectedEvent(rejected: {
    gateway: string;
    gatewayReference: string | null;
    status: PaymentGatewayStatus | null;
    outcome: 'ignored_backwards' | 'signature_invalid';
    correlationId?: string;
  }): Promise<void>;
}
