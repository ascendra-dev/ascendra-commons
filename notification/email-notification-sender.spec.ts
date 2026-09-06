import { describe, expect, it, vi } from 'vitest';
import { EmailNotificationSender } from './email-notification-sender';
import { NotificationConfig } from './notification-config';
import { UserContactResolver } from './user-contact-resolver';

function makeSender(overrides?: { config?: Partial<NotificationConfig>; users?: Partial<UserContactResolver> }) {
  const config: NotificationConfig = {
    channelsFor: vi.fn().mockResolvedValue(['email']),
    templateFor: vi.fn().mockResolvedValue({ subject: 'Invoice {{invoiceNumber}}', body: 'Hi' }),
    providerConfigFor: vi.fn().mockResolvedValue({ apiKey: 'key', from: 'billing@example.com' }),
    ...overrides?.config,
  };
  const users: UserContactResolver = {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides?.users,
  };
  return { sender: new EmailNotificationSender(config, users), config, users };
}

const REQUEST = { notificationType: 'invoice.sent', variables: { invoiceNumber: 'INV-001' } };

describe('EmailNotificationSender', () => {
  it('sends to a raw recipient using the email supplied directly, no user lookup', async () => {
    const { sender, users } = makeSender();

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw', email: 'payer@example.com' } });

    expect(result).toMatchObject({ status: 'sent' });
    expect(result.rendered?.body).toBeDefined();
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('resolves a user recipient via the injected UserContactResolver', async () => {
    const { sender, users } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ email: 'issuer@example.com' }) } });

    const result = await sender.send({ ...REQUEST, recipient: { type: 'user', id: 'issuer-1' } });

    expect(result).toMatchObject({ status: 'sent' });
    expect(result.rendered?.body).toBeDefined();
    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });

  it('fails without throwing when a raw recipient has no email — before any config lookup', async () => {
    const { sender, config } = makeSender();

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw' } });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
    expect(config.providerConfigFor).not.toHaveBeenCalled();
    expect(config.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when no provider config is registered for the tenant', async () => {
    const { sender, config } = makeSender({ config: { providerConfigFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw', email: 'payer@example.com' } });

    expect(result).toEqual({ status: 'failed', reason: 'no_provider_config' });
    expect(config.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when no template is registered for the notificationType', async () => {
    const { sender } = makeSender({ config: { templateFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw', email: 'payer@example.com' } });

    expect(result).toEqual({ status: 'failed', reason: 'template_not_found' });
  });

  it('asks the config for the email channel specifically', async () => {
    const { sender, config } = makeSender();

    await sender.send({ ...REQUEST, recipient: { type: 'raw', email: 'p@e.com' }, tenantId: 't1' });

    expect(config.providerConfigFor).toHaveBeenCalledWith('email', 't1');
    expect(config.templateFor).toHaveBeenCalledWith('email', 'invoice.sent', 't1');
  });
});
