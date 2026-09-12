import { describe, expect, it } from 'vitest';
import { assertValidMoney, InvalidMoneyError } from './assert-valid-money';

describe('assertValidMoney', () => {
  it('accepts a valid integer amount with a valid currency code', () => {
    expect(() => assertValidMoney({ amountMinorUnits: 150000, currency: 'PKR' })).not.toThrow();
  });

  it('accepts zero', () => {
    expect(() => assertValidMoney({ amountMinorUnits: 0, currency: 'USD' })).not.toThrow();
  });

  it('rejects a float amount', () => {
    expect(() => assertValidMoney({ amountMinorUnits: 1500.5, currency: 'USD' })).toThrow(InvalidMoneyError);
  });

  it('rejects NaN / Infinity', () => {
    expect(() => assertValidMoney({ amountMinorUnits: NaN, currency: 'USD' })).toThrow(/finite/);
    expect(() => assertValidMoney({ amountMinorUnits: Infinity, currency: 'USD' })).toThrow(/finite/);
  });

  it('rejects a negative amount by default', () => {
    expect(() => assertValidMoney({ amountMinorUnits: -100, currency: 'USD' })).toThrow(/negative/);
  });

  it('accepts a negative amount when allowNegative is true', () => {
    expect(() => assertValidMoney({ amountMinorUnits: -100, currency: 'USD' }, { allowNegative: true })).not.toThrow();
  });

  it('rejects a lowercase currency code', () => {
    expect(() => assertValidMoney({ amountMinorUnits: 100, currency: 'usd' })).toThrow(/currency/);
  });

  it('rejects a currency code of the wrong length', () => {
    expect(() => assertValidMoney({ amountMinorUnits: 100, currency: 'US' })).toThrow(/currency/);
  });

  it('reports every violation at once, not just the first', () => {
    try {
      assertValidMoney({ amountMinorUnits: 1.5, currency: 'us' });
      expect.fail('expected assertValidMoney to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidMoneyError);
      expect((err as InvalidMoneyError).reasons).toHaveLength(2);
    }
  });
});
