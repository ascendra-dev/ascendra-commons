import { DynamicModule, Module } from '@nestjs/common';
import { PostgresTokenResolutionRecorder } from './postgres-token-resolution-recorder';
import { PAYMENT_LINK_APPLICATION_ID, PAYMENT_LINK_SQL_EXECUTOR, POSTGRES_TOKEN_RESOLUTION_RECORDER } from '../tokens';

export interface PostgresTokenResolutionRecorderModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresTokenResolutionRecorder` and exports it as
 * `POSTGRES_TOKEN_RESOLUTION_RECORDER`. Pass that token — and this module in
 * the same `imports` array — to `PostgresPaymentLinkTokenServiceModule.forRoot()`.
 * Independent of that module and of `PostgresTokenResolutionObservabilityModule`
 * — import any subset; all three take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresTokenResolutionRecorderModule {
  static forRoot(config: PostgresTokenResolutionRecorderModuleConfig): DynamicModule {
    return {
      module: PostgresTokenResolutionRecorderModule,
      imports: config.imports ?? [],
      providers: [
        { provide: PAYMENT_LINK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: PAYMENT_LINK_APPLICATION_ID, useValue: config.application },
        PostgresTokenResolutionRecorder,
        { provide: POSTGRES_TOKEN_RESOLUTION_RECORDER, useExisting: PostgresTokenResolutionRecorder },
      ],
      exports: [POSTGRES_TOKEN_RESOLUTION_RECORDER],
    };
  }
}
