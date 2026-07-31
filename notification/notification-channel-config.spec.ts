import { describe, expect, it } from 'vitest';
import { StaticNotificationChannelConfig } from './notification-channel-config';

describe('StaticNotificationChannelConfig', () => {
  it('returns the configured channels for a known notificationType', async () => {
    const config = new StaticNotificationChannelConfig({
      'invoice.sent': ['email'],
      'payment.overdue.reminder': ['email', 'sms'],
    });

    await expect(config.channelsFor('payment.overdue.reminder')).resolves.toEqual(['email', 'sms']);
  });

  it('fails closed with an empty array for an unconfigured notificationType', async () => {
    const config = new StaticNotificationChannelConfig({ 'invoice.sent': ['email'] });

    await expect(config.channelsFor('unknown.type')).resolves.toEqual([]);
  });
});
