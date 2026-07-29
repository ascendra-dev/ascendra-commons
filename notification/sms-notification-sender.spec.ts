import { describe, expect, it, vi } from 'vitest';
import { SMSNotificationSender } from './sms-notification-sender';
import { NotificationTemplateRepository } from './notification-template';
import { UserContactResolver } from './user-contact-resolver';

function makeSender(overrides?: {
  templates?: Partial<NotificationTemplateRepository>;
  users?: Partial<UserContactResolver>;
}) {
  const templates: NotificationTemplateRepository = {
    templateFor: vi.fn().mockResolvedValue({ body: 'Amount due: {{amount}}' }),
    ...overrides?.templates,
  };
  const users: UserContactResolver = {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides?.users,
  };
  return { sender: new SMSNotificationSender(templates, users), templates, users };
}

describe('SMSNotificationSender', () => {
  it('sends to a raw recipient using the phone supplied directly, no user lookup', async () => {
    const { sender, users } = makeSender();

    const result = await sender.send({
      recipient: { type: 'raw', phone: '+923001234567' },
      notificationType: 'payment.overdue.reminder',
      variables: { amount: 1500 },
    });

    expect(result).toEqual({ status: 'sent' });
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('resolves a user recipient via the injected UserContactResolver', async () => {
    const { sender, users } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ phone: '+923009999999' }) } });

    const result = await sender.send({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'payment.overdue.reminder',
      variables: { amount: 1500 },
    });

    expect(result).toEqual({ status: 'sent' });
    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });

  it('fails without throwing when a raw recipient has no phone', async () => {
    const { sender, templates } = makeSender();

    const result = await sender.send({ recipient: { type: 'raw' }, notificationType: 'payment.overdue.reminder', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
    expect(templates.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when a user recipient has no stored phone', async () => {
    const { sender } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ email: 'a@b.com' }) } });

    const result = await sender.send({ recipient: { type: 'user', id: 'u1' }, notificationType: 'payment.overdue.reminder', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
  });

  it('fails without throwing when no template is registered for the notificationType', async () => {
    const { sender } = makeSender({ templates: { templateFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({
      recipient: { type: 'raw', phone: '+923001234567' },
      notificationType: 'unknown.type',
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'template_not_found' });
  });
});
