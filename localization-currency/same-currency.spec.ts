import { describe, expect, it } from 'vitest';
import { assertSameCurrency, CurrencyMismatchError, sameCurrency } from './same-currency';

describe('sameCurrency', () => {
  it('true when currencies match', () => {
    expect(sameCurrency({ amountMinorUnits: 100, currency: 'PKR' }, { amountMinorUnits: 200, currency: 'PKR' })).toBe(
      true,
    );
  });

  it('false when they differ', () => {
    expect(sameCurrency({ amountMinorUnits: 100, currency: 'PKR' }, { amountMinorUnits: 100, currency: 'USD' })).toBe(
      false,
    );
  });
});

describe('assertSameCurrency', () => {
  it('does not throw when currencies match', () => {
    expect(() =>
      assertSameCurrency({ amountMinorUnits: 100, currency: 'PKR' }, { amountMinorUnits: 200, currency: 'PKR' }),
    ).not.toThrow();
  });

  it('throws CurrencyMismatchError with both currencies when they differ', () => {
    try {
      assertSameCurrency({ amountMinorUnits: 100, currency: 'PKR' }, { amountMinorUnits: 100, currency: 'USD' });
      expect.fail('expected assertSameCurrency to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CurrencyMismatchError);
      expect((err as CurrencyMismatchError).expected).toBe('PKR');
      expect((err as CurrencyMismatchError).actual).toBe('USD');
    }
  });
});
