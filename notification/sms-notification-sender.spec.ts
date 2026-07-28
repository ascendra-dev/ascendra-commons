import { describe, expect, it, vi } from 'vitest';
import { SMSNotificationSender } from './sms-notification-sender';
import { NotificationTemplateRepository } from './notification-template';

const REQUEST = {
  recipient: { type: 'raw' as const, phone: '+923001234567' },
  notificationType: 'payment.overdue.reminder',
  variables: { amount: 1500 },
};

describe('SMSNotificationSender', () => {
  it('sends when a template exists for the notificationType', async () => {
    const templates: NotificationTemplateRepository = {
      templateFor: vi.fn().mockResolvedValue({ body: 'Amount due: {{amount}}' }),
    };
    const sender = new SMSNotificationSender(templates);

    const result = await sender.send(REQUEST);

    expect(result).toEqual({ status: 'sent' });
    expect(templates.templateFor).toHaveBeenCalledWith('payment.overdue.reminder');
  });

  it('fails without throwing when no template is registered for the notificationType', async () => {
    const templates: NotificationTemplateRepository = { templateFor: vi.fn().mockResolvedValue(null) };
    const sender = new SMSNotificationSender(templates);

    await expect(sender.send(REQUEST)).resolves.toEqual({ status: 'failed', reason: 'template_not_found' });
  });
});
