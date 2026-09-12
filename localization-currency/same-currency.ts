import type { Money } from './money.interface';

/** Thrown by `assertSameCurrency()`. */
export class CurrencyMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Currency mismatch: expected "${expected}", got "${actual}"`);
    this.name = 'CurrencyMismatchError';
  }
}

/** Plain comparison — no normalization, since a valid ISO 4217 code (per `assertValidMoney()`) is already uppercase. */
export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

/**
 * The primitive a project's own payment/refund logic uses to enforce "a
 * payment against this invoice must be in the invoice's own currency" —
 * `localization-currency-standard.md`'s own rules don't say what happens on a
 * mismatch (Phase 1 doesn't do FX conversion at all — see the module README),
 * so today a mismatch should always be a rejection, never a silent
 * conversion. The actual call site (e.g. inside a `PaymentGatewayAdapter`
 * implementation) stays project-specific; this only supplies the check.
 */
export function assertSameCurrency(expected: Money, actual: Money): void {
  if (!sameCurrency(expected, actual)) throw new CurrencyMismatchError(expected.currency, actual.currency);
}
