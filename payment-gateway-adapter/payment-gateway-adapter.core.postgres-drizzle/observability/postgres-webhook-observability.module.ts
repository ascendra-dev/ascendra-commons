import { DynamicModule, Module } from '@nestjs/common';
import { WEBHOOK_OBSERVABILITY_PORT } from '../../payment-gateway-adapter.core';
import { PostgresWebhookObservabilityService } from './postgres-webhook-observability.service';
import { WEBHOOK_APPLICATION_ID, WEBHOOK_SQL_EXECUTOR } from '../tokens';

export interface PostgresWebhookObservabilityModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_payment_gateway_webhook_event` — binds
 * `PostgresWebhookObservabilityService` under the core
 * `WEBHOOK_OBSERVABILITY_PORT` token, so `payment-gateway-adapter.api` (or
 * your own controller) depends on the port, not on Postgres.
 */
@Module({})
export class PostgresWebhookObservabilityModule {
  static forRoot(config: PostgresWebhookObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresWebhookObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: WEBHOOK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: WEBHOOK_APPLICATION_ID, useValue: config.application },
        PostgresWebhookObservabilityService,
        { provide: WEBHOOK_OBSERVABILITY_PORT, useExisting: PostgresWebhookObservabilityService },
      ],
      exports: [WEBHOOK_OBSERVABILITY_PORT],
    };
  }
}
