import { describe, expect, it } from 'vitest';
import { renderTemplate } from './notification-template';

describe('renderTemplate', () => {
  const template = {
    subject: 'Invoice {{invoiceNumber}} from {{issuerName}}',
    body: 'Amount due: {{amount}}',
  };

  it('substitutes every provided variable in subject and body', () => {
    const result = renderTemplate(template, { invoiceNumber: 'INV-001', issuerName: 'Greenfield School', amount: 1500 });
    expect(result.subject).toBe('Invoice INV-001 from Greenfield School');
    expect(result.body).toBe('Amount due: 1500');
  });

  it('leaves a missing variable as a visible placeholder rather than blanking it', () => {
    const result = renderTemplate(template, { invoiceNumber: 'INV-001' });
    expect(result.subject).toBe('Invoice INV-001 from {{issuerName}}');
  });

  it('omits subject entirely when the template has none (the SMS case)', () => {
    const result = renderTemplate({ body: 'Your code is {{code}}' }, { code: '1234' });
    expect(result.subject).toBeUndefined();
    expect(result.body).toBe('Your code is 1234');
  });

  it('carries isHtml through unchanged', () => {
    const result = renderTemplate({ body: '<p>hi</p>', isHtml: true }, {});
    expect(result.isHtml).toBe(true);
  });
});
