import { describe, expect, it, vi } from 'vitest';
import { EmailNotificationSender, EmailClient, UserContactResolver } from './email-notification-sender';
import { NotificationTemplateRepository } from './notification-template';

function makeSender(overrides?: {
  templates?: Partial<NotificationTemplateRepository>;
  users?: Partial<UserContactResolver>;
  emailClient?: Partial<EmailClient>;
}) {
  const templates: NotificationTemplateRepository = {
    findByEventType: vi.fn().mockResolvedValue({ eventType: 'invoice.sent', subject: 'Invoice {{invoiceNumber}}', body: 'Hi' }),
    ...overrides?.templates,
  };
  const users: UserContactResolver = {
    findById: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
    ...overrides?.users,
  };
  const emailClient: EmailClient = {
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides?.emailClient,
  };
  return { sender: new EmailNotificationSender(templates, users, emailClient), templates, users, emailClient };
}

describe('EmailNotificationSender', () => {
  it('sends to a raw recipient using the email supplied directly', async () => {
    const { sender, emailClient } = makeSender();

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      eventType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });

    expect(result.status).toBe('sent');
    expect(emailClient.send).toHaveBeenCalledWith({ to: 'payer@example.com', subject: 'Invoice INV-001', body: 'Hi' });
  });

  it('resolves a user recipient via the injected UserContactResolver', async () => {
    const { sender, users } = makeSender();

    await sender.send({ recipient: { type: 'user', id: 'issuer-1' }, eventType: 'invoice.sent', variables: {} });

    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });

  it('fails without sending when a raw recipient has no email', async () => {
    const { sender, emailClient } = makeSender();

    const result = await sender.send({ recipient: { type: 'raw' }, eventType: 'invoice.sent', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_email_available' });
    expect(emailClient.send).not.toHaveBeenCalled();
  });

  it('fails without sending when a user recipient has no stored email', async () => {
    const { sender, emailClient } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ phone: '+92...' }) } });

    const result = await sender.send({ recipient: { type: 'user', id: 'u1' }, eventType: 'invoice.sent', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_email_available' });
    expect(emailClient.send).not.toHaveBeenCalled();
  });

  it('fails when no template is registered for the event type', async () => {
    const { sender, emailClient } = makeSender({ templates: { findByEventType: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({ recipient: { type: 'raw', email: 'a@b.com' }, eventType: 'unknown.event', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'template_not_found' });
    expect(emailClient.send).not.toHaveBeenCalled();
  });

  it('never throws when the email client rejects — returns a failed result instead', async () => {
    const { sender } = makeSender({ emailClient: { send: vi.fn().mockRejectedValue(new Error('provider timeout')) } });

    await expect(
      sender.send({ recipient: { type: 'raw', email: 'a@b.com' }, eventType: 'invoice.sent', variables: {} }),
    ).resolves.toEqual({ status: 'failed', reason: 'provider timeout' });
  });
});
