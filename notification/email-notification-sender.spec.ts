import { describe, expect, it, vi } from 'vitest';
import { EmailNotificationSender } from './email-notification-sender';
import { NotificationTemplateRepository } from './notification-template';

const REQUEST = {
  recipient: { type: 'raw' as const, email: 'payer@example.com' },
  notificationType: 'invoice.sent',
  variables: { invoiceNumber: 'INV-001' },
};

describe('EmailNotificationSender', () => {
  it('sends when a template exists for the notificationType', async () => {
    const templates: NotificationTemplateRepository = {
      templateFor: vi.fn().mockResolvedValue({ subject: 'Invoice {{invoiceNumber}}', body: 'Hi' }),
    };
    const sender = new EmailNotificationSender(templates);

    const result = await sender.send(REQUEST);

    expect(result).toEqual({ status: 'sent' });
    expect(templates.templateFor).toHaveBeenCalledWith('invoice.sent');
  });

  it('fails without throwing when no template is registered for the notificationType', async () => {
    const templates: NotificationTemplateRepository = { templateFor: vi.fn().mockResolvedValue(null) };
    const sender = new EmailNotificationSender(templates);

    await expect(sender.send(REQUEST)).resolves.toEqual({ status: 'failed', reason: 'template_not_found' });
  });
});
