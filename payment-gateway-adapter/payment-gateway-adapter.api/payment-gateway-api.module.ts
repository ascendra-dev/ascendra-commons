import { DynamicModule, Module } from '@nestjs/common';
import type { PaymentGatewayApiModuleConfig } from './payment-gateway-api.options';
import { PaymentGatewayApiService } from './payment-gateway-api.service';
import { PaymentGatewayController } from './payment-gateway.controller';

/**
 * HTTP read endpoints for a webhook security/ops screen, over
 * `WEBHOOK_OBSERVABILITY_PORT`. Opt-in, stack-agnostic. Read-only — events
 * are write-once, so there is no mutation surface here (webhook handling
 * itself, and the concrete gateway adapters, stay in the vertical's own
 * controllers, since they touch project-specific domain types).
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('payment-gateway.view')`.
 *
 * ```typescript
 * PaymentGatewayApiModule.forRoot({
 *   imports: [PostgresWebhookObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
 * })
 * ```
 */
@Module({})
export class PaymentGatewayApiModule {
  static forRoot(config: PaymentGatewayApiModuleConfig = {}): DynamicModule {
    return {
      module: PaymentGatewayApiModule,
      imports: config.imports ?? [],
      controllers: [PaymentGatewayController],
      providers: [PaymentGatewayApiService],
    };
  }
}
