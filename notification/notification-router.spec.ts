import { describe, expect, it, vi } from 'vitest';
import { NotificationRouter } from './notification-router';
import { NotificationChannelPolicy } from './notification-channel-policy';
import { NotificationChannel, NotificationSender } from './notification.types';

function fakePolicy(channels: NotificationChannel[]): NotificationChannelPolicy {
  return { channelsFor: vi.fn().mockResolvedValue(channels) };
}

function fakeSender(result: { status: 'sent' | 'failed'; reason?: string }): NotificationSender {
  return { send: vi.fn().mockResolvedValue(result) };
}

const REQUEST = { recipient: { type: 'raw' as const, email: 'a@b.com' }, eventType: 'invoice.sent', variables: {} };

describe('NotificationRouter', () => {
  it('reports sent when every channel sends', async () => {
    const email = fakeSender({ status: 'sent' });
    const log = fakeSender({ status: 'sent' });
    const router = new NotificationRouter(fakePolicy(['email', 'log']), new Map([['email', email], ['log', log]]));

    const result = await router.send(REQUEST);

    expect(result).toEqual({
      status: 'sent',
      channels: { email: { status: 'sent' }, log: { status: 'sent' } },
    });
  });

  it('reports failed when every channel fails', async () => {
    const email = fakeSender({ status: 'failed', reason: 'no_email_available' });
    const log = fakeSender({ status: 'failed', reason: 'store_unavailable' });
    const router = new NotificationRouter(fakePolicy(['email', 'log']), new Map([['email', email], ['log', log]]));

    const result = await router.send(REQUEST);

    expect(result).toEqual({
      status: 'failed',
      channels: {
        email: { status: 'failed', reason: 'no_email_available' },
        log: { status: 'failed', reason: 'store_unavailable' },
      },
    });
  });

  it('reports partial with a full per-channel breakdown when channels disagree', async () => {
    const email = fakeSender({ status: 'sent' });
    const log = fakeSender({ status: 'failed', reason: 'store_unavailable' });
    const router = new NotificationRouter(fakePolicy(['email', 'log']), new Map([['email', email], ['log', log]]));

    const result = await router.send(REQUEST);

    expect(result.status).toBe('partial');
    expect(result.channels).toEqual({
      email: { status: 'sent' },
      log: { status: 'failed', reason: 'store_unavailable' },
    });
  });

  it('calls every configured channel with the exact same request', async () => {
    const email = fakeSender({ status: 'sent' });
    const log = fakeSender({ status: 'sent' });
    const router = new NotificationRouter(fakePolicy(['email', 'log']), new Map([['email', email], ['log', log]]));

    await router.send(REQUEST);

    expect(email.send).toHaveBeenCalledWith(REQUEST);
    expect(log.send).toHaveBeenCalledWith(REQUEST);
  });

  it('fails closed with no_channel_configured when the policy returns no channels', async () => {
    const router = new NotificationRouter(fakePolicy([]), new Map());

    const result = await router.send(REQUEST);

    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
  });

  it('treats a configured channel with no registered sender as a per-channel failure, not a crash', async () => {
    const email = fakeSender({ status: 'sent' });
    // 'log' is configured by the policy but never registered in the senders map —
    // a realistic misconfiguration (policy and sender map maintained separately).
    const router = new NotificationRouter(fakePolicy(['email', 'log']), new Map([['email', email]]));

    const result = await router.send(REQUEST);

    expect(result.status).toBe('partial');
    expect(result.channels).toEqual({
      email: { status: 'sent' },
      log: { status: 'failed', reason: 'channel_not_registered' },
    });
  });

  it('only sends via the channels the policy selects, not every registered sender', async () => {
    const email = fakeSender({ status: 'sent' });
    const log = fakeSender({ status: 'sent' });
    // Only 'email' is selected for this event type — 'log' is registered but not chosen.
    const router = new NotificationRouter(fakePolicy(['email']), new Map([['email', email], ['log', log]]));

    const result = await router.send(REQUEST);

    expect(result.channels).toEqual({ email: { status: 'sent' } });
    expect(log.send).not.toHaveBeenCalled();
  });
});
