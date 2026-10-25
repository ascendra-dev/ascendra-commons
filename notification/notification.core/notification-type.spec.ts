import { describe, expect, it } from 'vitest';
import { sampleVariables, templateVariables } from './notification-type';

describe('notification types', () => {
  it('templateVariables finds each {{placeholder}} once, across subject and body', () => {
    expect(templateVariables('Invoice {{invoiceNumber}}', 'Hi {{name}}, {{amount}} for {{invoiceNumber}}', null)).toEqual([
      'invoiceNumber',
      'name',
      'amount',
    ]);
    expect(templateVariables('no placeholders', undefined)).toEqual([]);
  });

  it('sampleVariables — the declared samples, skipping a variable without one', () => {
    expect(
      sampleVariables({ name: 'invoice.sent', variables: [{ name: 'amount', sample: '4,820.00' }, { name: 'note' }] }),
    ).toEqual({ amount: '4,820.00' });
    expect(sampleVariables(undefined)).toEqual({});
  });
});
