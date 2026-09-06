import { describe, expect, it, vi } from 'vitest';
import { SMSNotificationSender } from './sms-notification-sender';
import { NotificationConfig } from './notification-config';
import { UserContactResolver } from './user-contact-resolver';

function makeSender(overrides?: { config?: Partial<NotificationConfig>; users?: Partial<UserContactResolver> }) {
  const config: NotificationConfig = {
    channelsFor: vi.fn().mockResolvedValue(['sms']),
    templateFor: vi.fn().mockResolvedValue({ body: 'Amount due: {{amount}}' }),
    providerConfigFor: vi.fn().mockResolvedValue({ apiKey: 'key', from: '+10000000000' }),
    ...overrides?.config,
  };
  const users: UserContactResolver = {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides?.users,
  };
  return { sender: new SMSNotificationSender(config, users), config, users };
}

const REQUEST = { notificationType: 'payment.overdue.reminder', variables: { amount: 1500 } };

describe('SMSNotificationSender', () => {
  it('sends to a raw recipient using the phone supplied directly, no user lookup', async () => {
    const { sender, users } = makeSender();

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw', phone: '+923001234567' } });

    expect(result).toMatchObject({ status: 'sent' });
    expect(result.rendered?.body).toBeDefined();
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('resolves a user recipient via the injected UserContactResolver', async () => {
    const { sender, users } = makeSender({ users: { findById: vi.fn().mockResolvedValue({ phone: '+923009999999' }) } });

    const result = await sender.send({ ...REQUEST, recipient: { type: 'user', id: 'issuer-1' } });

    expect(result).toMatchObject({ status: 'sent' });
    expect(result.rendered?.body).toBeDefined();
    expect(users.findById).toHaveBeenCalledWith('issuer-1');
  });

  it('fails without throwing when a raw recipient has no phone — before any config lookup', async () => {
    const { sender, config } = makeSender();

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw' } });

    expect(result).toEqual({ status: 'failed', reason: 'no_address_available' });
    expect(config.providerConfigFor).not.toHaveBeenCalled();
    expect(config.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when no provider config is registered for the tenant', async () => {
    const { sender, config } = makeSender({ config: { providerConfigFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw', phone: '+923001234567' } });

    expect(result).toEqual({ status: 'failed', reason: 'no_provider_config' });
    expect(config.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when no template is registered for the notificationType', async () => {
    const { sender } = makeSender({ config: { templateFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({ ...REQUEST, recipient: { type: 'raw', phone: '+923001234567' } });

    expect(result).toEqual({ status: 'failed', reason: 'template_not_found' });
  });

  it('asks the config for the sms channel specifically', async () => {
    const { sender, config } = makeSender();

    await sender.send({ ...REQUEST, recipient: { type: 'raw', phone: '+92300' }, tenantId: 't1' });

    expect(config.providerConfigFor).toHaveBeenCalledWith('sms', 't1');
    expect(config.templateFor).toHaveBeenCalledWith('sms', 'payment.overdue.reminder', 't1');
  });
});
