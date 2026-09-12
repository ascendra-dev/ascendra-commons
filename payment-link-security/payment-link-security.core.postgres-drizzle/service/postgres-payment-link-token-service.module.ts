import { DynamicModule, Module, Provider } from '@nestjs/common';
import { NoopTokenResolutionRecorder, TOKEN_RESOLUTION_RECORDER } from '../../payment-link-security.core';
import { PostgresPaymentLinkTokenService } from './postgres-payment-link-token-service';
import { PAYMENT_LINK_APPLICATION_ID, PAYMENT_LINK_SQL_EXECUTOR, POSTGRES_PAYMENT_LINK_TOKEN_SERVICE } from '../tokens';

export interface PostgresPaymentLinkTokenServiceModuleConfig {
  /** The token the consuming app provides its Drizzle db under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — stamped on every token row. */
  application: string;
  /**
   * Token an `TokenResolutionRecorder` implementation is provided under (e.g.
   * `POSTGRES_TOKEN_RESOLUTION_RECORDER`). Omit and every resolution attempt
   * goes unrecorded (`NoopTokenResolutionRecorder`) — `resolve()` still works
   * exactly as before, just without a resolution log.
   */
  recorderToken?: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the providers behind `sqlExecutorToken` / `recorderToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresPaymentLinkTokenService` and exports it as
 * `POSTGRES_PAYMENT_LINK_TOKEN_SERVICE`. Pass that token — and this module in
 * the same `imports` array — to `PaymentLinkSecurityModule.forRoot()`.
 *
 * ```typescript
 * PaymentLinkSecurityModule.forRoot({
 *   serviceToken: POSTGRES_PAYMENT_LINK_TOKEN_SERVICE,
 *   imports: [
 *     PostgresPaymentLinkTokenServiceModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay',
 *       recorderToken: POSTGRES_TOKEN_RESOLUTION_RECORDER,   // optional
 *       imports: [DatabaseModule, PostgresTokenResolutionRecorderModule.forRoot({ ... })],
 *     }),
 *   ],
 * })
 * ```
 */
@Module({})
export class PostgresPaymentLinkTokenServiceModule {
  static forRoot(config: PostgresPaymentLinkTokenServiceModuleConfig): DynamicModule {
    const recorderProvider: Provider = config.recorderToken
      ? { provide: TOKEN_RESOLUTION_RECORDER, useExisting: config.recorderToken }
      : { provide: TOKEN_RESOLUTION_RECORDER, useClass: NoopTokenResolutionRecorder };

    return {
      module: PostgresPaymentLinkTokenServiceModule,
      imports: config.imports ?? [],
      providers: [
        { provide: PAYMENT_LINK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: PAYMENT_LINK_APPLICATION_ID, useValue: config.application },
        recorderProvider,
        PostgresPaymentLinkTokenService,
        { provide: POSTGRES_PAYMENT_LINK_TOKEN_SERVICE, useExisting: PostgresPaymentLinkTokenService },
      ],
      exports: [POSTGRES_PAYMENT_LINK_TOKEN_SERVICE],
    };
  }
}
