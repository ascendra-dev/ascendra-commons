import { DynamicModule, Module } from '@nestjs/common';
import type { PaymentLinkApiModuleConfig } from './payment-link-api.options';
import { PaymentLinkApiService } from './payment-link-api.service';
import { PaymentLinkController } from './payment-link.controller';

/**
 * HTTP read endpoints for a payment-link security/ops screen, over
 * `TOKEN_RESOLUTION_OBSERVABILITY_PORT`. Opt-in, stack-agnostic. Read-only —
 * resolution attempts are write-once, so there is no mutation surface here
 * (token `generate()`/`revoke()` stay in the vertical's own controllers,
 * since they're driven by project-specific events — an invoice being
 * created, voided, or paid).
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('payment-link.view')`.
 *
 * ```typescript
 * PaymentLinkApiModule.forRoot({
 *   imports: [PostgresTokenResolutionObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
 * })
 * ```
 */
@Module({})
export class PaymentLinkApiModule {
  static forRoot(config: PaymentLinkApiModuleConfig = {}): DynamicModule {
    return {
      module: PaymentLinkApiModule,
      imports: config.imports ?? [],
      controllers: [PaymentLinkController],
      providers: [PaymentLinkApiService],
    };
  }
}
