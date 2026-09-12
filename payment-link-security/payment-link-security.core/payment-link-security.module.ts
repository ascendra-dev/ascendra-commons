import { DynamicModule, Module } from '@nestjs/common';
import { PAYMENT_LINK_TOKEN_SERVICE } from './tokens';

export interface PaymentLinkSecurityModuleConfig {
  /**
   * The injection token a `PaymentLinkTokenService` implementation is
   * provided under by a module in `imports`. `useExisting`-aliased to
   * `PAYMENT_LINK_TOKEN_SERVICE`.
   *
   *   - `POSTGRES_PAYMENT_LINK_TOKEN_SERVICE` (payment-link-security.core.postgres-drizzle)
   *   - or your own store.
   *
   * `.core` ships no implementation.
   */
  serviceToken: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the provider behind `serviceToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Pure token wiring — aliases `PAYMENT_LINK_TOKEN_SERVICE` to `serviceToken`
 * and nothing else. Call sites inject `PAYMENT_LINK_TOKEN_SERVICE`, never a
 * concrete class.
 */
@Module({})
export class PaymentLinkSecurityModule {
  static forRoot(config: PaymentLinkSecurityModuleConfig): DynamicModule {
    if (!config?.serviceToken) {
      throw new Error(
        'PaymentLinkSecurityModule.forRoot() requires serviceToken — POSTGRES_PAYMENT_LINK_TOKEN_SERVICE ' +
          'from payment-link-security.core.postgres-drizzle, or your own PaymentLinkTokenService token.',
      );
    }
    return {
      module: PaymentLinkSecurityModule,
      imports: config.imports ?? [],
      providers: [{ provide: PAYMENT_LINK_TOKEN_SERVICE, useExisting: config.serviceToken }],
      exports: [PAYMENT_LINK_TOKEN_SERVICE],
    };
  }
}
