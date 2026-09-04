import { describe, expect, it } from 'vitest';
import { StaticNotificationChannelConfig } from './notification-channel-config';

describe('StaticNotificationChannelConfig', () => {
  it('returns the configured channels for a known notificationType', async () => {
    const config = new StaticNotificationChannelConfig({
      'invoice.sent': ['email'],
      'payment.overdue.reminder': ['email', 'sms'],
    });

    await expect(config.channelsFor('payment.overdue.reminder', null)).resolves.toEqual(['email', 'sms']);
  });

  it('fails closed with an empty array for an unconfigured notificationType', async () => {
    const config = new StaticNotificationChannelConfig({ 'invoice.sent': ['email'] });

    await expect(config.channelsFor('unknown.type', null)).resolves.toEqual([]);
  });

  it('ignores tenantId — one config for the whole deployment, by design', async () => {
    const config = new StaticNotificationChannelConfig({ 'invoice.sent': ['email'] });

    await expect(config.channelsFor('invoice.sent', 't1')).resolves.toEqual(['email']);
    await expect(config.channelsFor('invoice.sent', 't2')).resolves.toEqual(['email']);
  });
});
