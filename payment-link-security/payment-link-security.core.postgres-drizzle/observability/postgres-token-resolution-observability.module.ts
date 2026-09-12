import { DynamicModule, Module } from '@nestjs/common';
import { TOKEN_RESOLUTION_OBSERVABILITY_PORT } from '../../payment-link-security.core';
import { PostgresTokenResolutionObservabilityService } from './postgres-token-resolution-observability.service';
import { PAYMENT_LINK_APPLICATION_ID, PAYMENT_LINK_SQL_EXECUTOR } from '../tokens';

export interface PostgresTokenResolutionObservabilityModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_payment_link_resolution` — binds
 * `PostgresTokenResolutionObservabilityService` under the core
 * `TOKEN_RESOLUTION_OBSERVABILITY_PORT` token, so `payment-link-security.api`
 * (or your own controller) depends on the port, not on Postgres.
 */
@Module({})
export class PostgresTokenResolutionObservabilityModule {
  static forRoot(config: PostgresTokenResolutionObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresTokenResolutionObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: PAYMENT_LINK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: PAYMENT_LINK_APPLICATION_ID, useValue: config.application },
        PostgresTokenResolutionObservabilityService,
        { provide: TOKEN_RESOLUTION_OBSERVABILITY_PORT, useExisting: PostgresTokenResolutionObservabilityService },
      ],
      exports: [TOKEN_RESOLUTION_OBSERVABILITY_PORT],
    };
  }
}
