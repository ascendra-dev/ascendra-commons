import { DynamicModule, Module } from '@nestjs/common';
import { WEBHOOK_EVENT_LOG } from '../../payment-gateway-adapter.core';
import { PostgresWebhookEventLog } from './postgres-webhook-event-log';
import { POSTGRES_WEBHOOK_EVENT_LOG, WEBHOOK_APPLICATION_ID, WEBHOOK_SQL_EXECUTOR } from '../tokens';

export interface PostgresWebhookEventLogModuleConfig {
  /** The token the consuming app provides its Drizzle db under — a normal pooled connection is fine (one INSERT/claim per webhook). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — stamped on every row. */
  application: string;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresWebhookEventLog` and binds it under both
 * `POSTGRES_WEBHOOK_EVENT_LOG` (for direct injection) and the core
 * `WEBHOOK_EVENT_LOG` token (so a webhook controller depends on the port,
 * not on Postgres, the same convention every other module in this library
 * follows).
 */
@Module({})
export class PostgresWebhookEventLogModule {
  static forRoot(config: PostgresWebhookEventLogModuleConfig): DynamicModule {
    return {
      module: PostgresWebhookEventLogModule,
      imports: config.imports ?? [],
      providers: [
        { provide: WEBHOOK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: WEBHOOK_APPLICATION_ID, useValue: config.application },
        PostgresWebhookEventLog,
        { provide: POSTGRES_WEBHOOK_EVENT_LOG, useExisting: PostgresWebhookEventLog },
        { provide: WEBHOOK_EVENT_LOG, useExisting: PostgresWebhookEventLog },
      ],
      exports: [POSTGRES_WEBHOOK_EVENT_LOG, WEBHOOK_EVENT_LOG],
    };
  }
}
