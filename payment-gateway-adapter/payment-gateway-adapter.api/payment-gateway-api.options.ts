import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate name `payment-gateway-adapter.api`'s endpoints
 * declare. Fixed — `@RequiresAction` is applied at class-definition time.
 * Restrict this to an ops/security persona — the most security-critical path
 * in a payments system deserves a narrow audience.
 */
export const WEBHOOK_ACTIONS = {
  /** Read the webhook event log and outcome counts. */
  VIEW: 'payment-gateway.view',
} as const;

export interface PaymentGatewayApiModuleConfig {
  /** Modules exporting `WEBHOOK_OBSERVABILITY_PORT` (a stack adapter's `PostgresWebhookObservabilityModule`). */
  imports?: DynamicModule['imports'];
}
