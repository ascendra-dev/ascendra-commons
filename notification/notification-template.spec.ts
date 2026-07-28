import { describe, expect, it } from 'vitest';
import { renderTemplate } from './notification-template';

describe('renderTemplate', () => {
  const template = { eventType: 'invoice.sent', subject: 'Invoice {{invoiceNumber}} from {{issuerName}}', body: 'Amount due: {{amount}}' };

  it('substitutes every provided variable', () => {
    const result = renderTemplate(template, { invoiceNumber: 'INV-001', issuerName: 'Greenfield School', amount: 1500 });
    expect(result.subject).toBe('Invoice INV-001 from Greenfield School');
    expect(result.body).toBe('Amount due: 1500');
  });

  it('leaves a missing variable as a visible placeholder rather than blanking it', () => {
    const result = renderTemplate(template, { invoiceNumber: 'INV-001' });
    expect(result.subject).toBe('Invoice INV-001 from {{issuerName}}');
  });

  it('coerces numeric variables to strings', () => {
    const result = renderTemplate({ eventType: 'x', subject: '{{n}}', body: '' }, { n: 42 });
    expect(result.subject).toBe('42');
  });
});
