import { describe, expect, it } from 'vitest';
import { decimalToMinorUnits, minorUnitDigits, minorUnitsToDecimal } from './minor-units';

describe('minorUnitDigits', () => {
  it('is 2 for the common case, including PKR (this module\'s own worked example currency)', () => {
    expect(minorUnitDigits('PKR')).toBe(2);
    expect(minorUnitDigits('USD')).toBe(2);
  });

  it('is 2 for PKR specifically, NOT 0 — the regression this module exists to prevent', () => {
    // Intl.NumberFormat('en-US', { style: 'currency', currency: 'PKR' })
    //   .resolvedOptions().maximumFractionDigits === 0 in Node's ICU data (a CLDR
    // display-rounding convention, since paisa has fallen out of practical use) —
    // but ISO 4217's formal minor-unit exponent for PKR is 2, matching this
    // standard's own "150000 = PKR 1,500.00" example. Using Intl here would
    // silently miscalculate every PKR amount by a factor of 100.
    expect(minorUnitDigits('PKR')).not.toBe(0);
    expect(minorUnitDigits('PKR')).toBe(2);
  });

  it('is 0 for a currency with no minor unit (JPY)', () => {
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('is 3 for a currency with a three-digit minor unit (KWD)', () => {
    expect(minorUnitDigits('KWD')).toBe(3);
  });
});

describe('minorUnitsToDecimal', () => {
  it('divides by 100 for a 2-decimal currency', () => {
    expect(minorUnitsToDecimal({ amountMinorUnits: 150000, currency: 'PKR' })).toBe(1500);
  });

  it('does NOT divide by 100 for JPY — the bug a naive /100 conversion would introduce', () => {
    expect(minorUnitsToDecimal({ amountMinorUnits: 1500, currency: 'JPY' })).toBe(1500);
  });

  it('divides by 1000 for a 3-decimal currency (KWD)', () => {
    expect(minorUnitsToDecimal({ amountMinorUnits: 1500000, currency: 'KWD' })).toBe(1500);
  });
});

describe('decimalToMinorUnits', () => {
  it('round-trips with minorUnitsToDecimal for a 2-decimal currency', () => {
    const money = decimalToMinorUnits(1500, 'PKR');
    expect(money).toEqual({ amountMinorUnits: 150000, currency: 'PKR' });
    expect(minorUnitsToDecimal(money)).toBe(1500);
  });

  it('round-trips for JPY (0 decimals)', () => {
    expect(decimalToMinorUnits(1500, 'JPY')).toEqual({ amountMinorUnits: 1500, currency: 'JPY' });
  });

  it('rounds to the nearest minor unit', () => {
    expect(decimalToMinorUnits(1500.999, 'PKR').amountMinorUnits).toBe(150100);
  });
});
