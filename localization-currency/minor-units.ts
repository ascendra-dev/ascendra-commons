import type { Money } from './money.interface';

/**
 * ISO 4217's minor-unit exponent, by exception — **not** derived from
 * `Intl.NumberFormat`. `Intl`'s `resolvedOptions().maximumFractionDigits` is a
 * CLDR *display/rounding* convention, which diverges from ISO 4217's formal
 * minor-unit exponent for several currencies whose smallest coin has fallen
 * out of practical use — PKR is exactly this case: ISO 4217 gives it 2
 * (paisa), matching this standard's own worked example ("150000 = PKR
 * 1,500.00"), but `Intl.NumberFormat('en-US', { style: 'currency', currency:
 * 'PKR' }).resolvedOptions().maximumFractionDigits` returns **0** in Node's
 * ICU data (COP and HUF diverge the same way). Using `Intl` here would have
 * silently miscalculated every PKR amount by a factor of 100 — caught by this
 * module's own tests, not assumed away.
 *
 * These two lists are the complete, stable ISO 4217 exceptions; every
 * currency not listed uses the default (2).
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
  'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const DEFAULT_MINOR_UNIT_DIGITS = 2;

/** ISO 4217's minor-unit exponent for `currency` — how many `amountMinorUnits` make up one major unit, as a power of 10. */
export function minorUnitDigits(currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(currency)) return 3;
  return DEFAULT_MINOR_UNIT_DIGITS;
}

/** `Money.amountMinorUnits` → a plain decimal number (150000 PKR → 1500), correct for any currency's actual ISO 4217 minor-unit exponent. */
export function minorUnitsToDecimal(money: Money): number {
  return money.amountMinorUnits / 10 ** minorUnitDigits(money.currency);
}

/** The inverse — a decimal amount (as a human or a legacy integration might supply it) → `Money`'s integer minor-unit form. */
export function decimalToMinorUnits(amount: number, currency: string): Money {
  return { amountMinorUnits: Math.round(amount * 10 ** minorUnitDigits(currency)), currency };
}
