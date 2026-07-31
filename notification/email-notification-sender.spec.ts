import { describe, expect, it, vi } from 'vitest';
import { EmailNotificationSender } from './email-notification-sender';
import { NotificationTemplateRepository } from './notification-template';
import { UserContactResolver } from './user-contact-resolver';

function makeSender(overrides?: {
  templates?: Partial<NotificationTemplateRepository>;
  users?: Partial<UserContactResolver>;
}) {
  const templates: NotificationTemplateRepository = {
    templateFor: vi.fn().mockResolvedValue({ subject: 'Invoice {{invoiceNumber}}', body: 'Hi' }),
    ...overrides?.templates,
  };
  const users: UserContactResolver = {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides?.users,
  };
  return { sender: new EmailNotificationSender(templates, users), templates, users };
}

describe('EmailNotificationSender', () => {
  it('sends to a raw recipient using the email supplied directly, no user lookup', async () => {
    const { sender, users } = makeSender();

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });

    expect(result).toEqual({ status: 'sent' });
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('resolves a user recipient via the injected UserContactResolver', async () => {
    const { sender, users } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ email: 'issuer@example.com' }) } });

    const result = await sender.send({
      recipient: { type: 'user', id: 'issuer-1' },
      notificationType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });

    expect(result).toEqual({ status: 'sent' });
    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });

  it('fails without throwing when a raw recipient has no email', async () => {
    const { sender, templates } = makeSender();

    const result = await sender.send({ recipient: { type: 'raw' }, notificationType: 'invoice.sent', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
    expect(templates.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when a user recipient has no stored email', async () => {
    const { sender } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ phone: '+92...' }) } });

    const result = await sender.send({ recipient: { type: 'user', id: 'u1' }, notificationType: 'invoice.sent', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
  });

  it('fails without throwing when a user recipient does not resolve at all', async () => {
    const { sender } = makeSender({ users: { findById: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({ recipient: { type: 'user', id: 'unknown' }, notificationType: 'invoice.sent', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
  });

  it('fails without throwing when no template is registered for the notificationType', async () => {
    const { sender } = makeSender({ templates: { templateFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'unknown.type',
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'template_not_found' });
  });
});
