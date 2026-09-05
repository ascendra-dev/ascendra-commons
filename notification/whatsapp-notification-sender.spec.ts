import { describe, expect, it, vi } from 'vitest';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';
import { ProviderConfigResolver, WhatsappProviderConfig } from './notification-provider-config';

function makeSender(overrides?: { providerConfig?: Partial<ProviderConfigResolver<WhatsappProviderConfig>> }) {
  const providerConfig: ProviderConfigResolver<WhatsappProviderConfig> = {
    configFor: vi.fn().mockResolvedValue({ apiKey: 'key', fromNumber: '+10000000000' }),
    ...overrides?.providerConfig,
  };
  return { sender: new WhatsappNotificationSender(providerConfig), providerConfig };
}

describe('WhatsappNotificationSender', () => {
  it('is a stub that reports sent once provider config resolves — no template lookup or real delivery yet', async () => {
    const { sender } = makeSender();

    const result = await sender.send({
      recipient: { type: 'raw', phone: '+923001234567' },
      notificationType: 'invoice.sent',
      variables: {},
    });

    expect(result).toEqual({ status: 'sent' });
  });

  it('fails without throwing when no provider config is configured for the tenant', async () => {
    const { sender } = makeSender({ providerConfig: { configFor: vi.fn().mockResolvedValue(null) } });

    const result = await sender.send({
      recipient: { type: 'raw', phone: '+923001234567' },
      notificationType: 'invoice.sent',
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'no_provider_config' });
  });
});
