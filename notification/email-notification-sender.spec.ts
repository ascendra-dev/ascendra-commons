import { describe, expect, it, vi } from 'vitest';
import { EmailNotificationSender } from './email-notification-sender';
import { NotificationTemplateRepository } from './notification-template';
import { UserContactResolver } from './user-contact-resolver';
import { EmailProviderConfig, ProviderConfigResolver } from './notification-provider-config';

function makeSender(overrides?: {
  templates?: Partial<NotificationTemplateRepository>;
  users?: Partial<UserContactResolver>;
  providerConfig?: Partial<ProviderConfigResolver<EmailProviderConfig>>;
}) {
  const templates: NotificationTemplateRepository = {
    templateFor: vi.fn().mockResolvedValue({ subject: 'Invoice {{invoiceNumber}}', body: 'Hi' }),
    ...overrides?.templates,
  };
  const users: UserContactResolver = {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides?.users,
  };
  const providerConfig: ProviderConfigResolver<EmailProviderConfig> = {
    configFor: vi.fn().mockResolvedValue({ apiKey: 'key', fromAddress: 'billing@example.com' }),
    ...overrides?.providerConfig,
  };
  return { sender: new EmailNotificationSender(templates, users, providerConfig), templates, users, providerConfig };
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
    const { sender, templates, providerConfig } = makeSender();

    const result = await sender.send({ recipient: { type: 'raw' }, notificationType: 'invoice.sent', variables: {} });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
    expect(providerConfig.configFor).not.toHaveBeenCalled();
    expect(templates.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when no provider config is configured for the tenant', async () => {
    const { sender, templates } = makeSender({ providerConfig: { configFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      notificationType: 'invoice.sent',
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'no_provider_config' });
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
