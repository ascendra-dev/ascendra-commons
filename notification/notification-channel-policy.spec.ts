import { describe, expect, it } from 'vitest';
import { StaticNotificationChannelPolicy } from './notification-channel-policy';

describe('StaticNotificationChannelPolicy', () => {
  it('returns the configured channels for a known event type', async () => {
    const policy = new StaticNotificationChannelPolicy({
      'invoice.sent': ['email'],
      'payment.overdue.reminder': ['email', 'log'],
    });

    await expect(policy.channelsFor('payment.overdue.reminder')).resolves.toEqual(['email', 'log']);
  });

  it('fails closed with an empty array for an unconfigured event type', async () => {
    const policy = new StaticNotificationChannelPolicy({ 'invoice.sent': ['email'] });

    await expect(policy.channelsFor('unknown.event')).resolves.toEqual([]);
  });
});
