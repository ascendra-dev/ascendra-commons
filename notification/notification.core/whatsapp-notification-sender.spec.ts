import { describe, expect, it, vi } from 'vitest';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';
import { NotificationConfig } from './notification-config.port';

function makeSender(overrides?: Partial<NotificationConfig>) {
  const config: NotificationConfig = {
    channelsFor: vi.fn().mockResolvedValue(['whatsapp']),
    templateFor: vi.fn().mockResolvedValue(null),
    providerConfigFor: vi.fn().mockResolvedValue({ apiKey: 'key', from: '+10000000000' }),
    ...overrides,
  };
  return { sender: new WhatsappNotificationSender(config), config };
}

const REQUEST = { recipient: { type: 'raw' as const, phone: '+923001234567' }, notificationType: 'invoice.sent', variables: {} };

describe('WhatsappNotificationSender', () => {
  it('is a stub that reports sent once provider config resolves — no template lookup or real delivery yet', async () => {
    const { sender, config } = makeSender();

    await expect(sender.send(REQUEST)).resolves.toEqual({ status: 'sent' });
    expect(config.templateFor).not.toHaveBeenCalled();
  });

  it('fails without throwing when no provider config is configured for the tenant', async () => {
    const { sender } = makeSender({ providerConfigFor: vi.fn().mockResolvedValue(null) });

    await expect(sender.send(REQUEST)).resolves.toEqual({ status: 'failed', reason: 'no_provider_config' });
  });

  it('asks the config for the whatsapp channel specifically', async () => {
    const { sender, config } = makeSender();

    await sender.send({ ...REQUEST, tenantId: 't1' });

    expect(config.providerConfigFor).toHaveBeenCalledWith('whatsapp', 't1');
  });
});
