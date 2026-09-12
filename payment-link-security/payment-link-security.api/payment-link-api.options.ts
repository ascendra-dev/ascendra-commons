import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate name `payment-link-security.api`'s endpoints
 * declare. Fixed — `@RequiresAction` is applied at class-definition time.
 * Restrict this to an ops/security persona — resolution attempts are not
 * tenant-scoped (see `PaymentLinkApiService`'s doc comment).
 */
export const PAYMENT_LINK_ACTIONS = {
  /** Read the resolution log and outcome counts. */
  VIEW: 'payment-link.view',
} as const;

export interface PaymentLinkApiModuleConfig {
  /** Modules exporting `TOKEN_RESOLUTION_OBSERVABILITY_PORT` (a stack adapter's `PostgresTokenResolutionObservabilityModule`). */
  imports?: DynamicModule['imports'];
}
