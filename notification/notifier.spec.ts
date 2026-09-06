import { describe, expect, it, vi } from 'vitest';
import { Notifier, NotificationDeliveryError } from './notifier';
import { NotificationConfig } from './notification-config';
import { NotificationChannel, NotificationChannelResult } from './notification.types';
import { NotificationSender } from './notification-sender';

/** Notifier only calls channelsFor — the senders own template/provider resolution. */
function fakeConfig(channels: NotificationChannel[]): NotificationConfig {
  return { channelsFor: vi.fn().mockResolvedValue(channels) } as unknown as NotificationConfig;
}

function throwingConfig(err: unknown): NotificationConfig {
  return { channelsFor: vi.fn().mockRejectedValue(err) } as unknown as NotificationConfig;
}

function fakeSender(result: NotificationChannelResult): NotificationSender {
  return { send: vi.fn().mockResolvedValue(result) };
}

function throwingSender(err: unknown): NotificationSender {
  return { send: vi.fn().mockRejectedValue(err) };
}

const REQUEST = { recipient: { type: 'raw' as const, email: 'a@b.com' }, notificationType: 'invoice.sent', variables: {} };

describe('Notifier.notify', () => {
  it('reports sent when every channel sends', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'sent' });
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]));

    const result = await notifier.notify(REQUEST);

    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'sent' }, sms: { status: 'sent' } } });
  });

  it('reports failed when every channel fails', async () => {
    const email = fakeSender({ status: 'failed', reason: 'no_email' });
    const sms = fakeSender({ status: 'failed', reason: 'no_phone' });
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]));

    const result = await notifier.notify(REQUEST);

    expect(result).toEqual({
      status: 'failed',
      channels: { email: { status: 'failed', reason: 'no_email' }, sms: { status: 'failed', reason: 'no_phone' } },
    });
  });

  it('reports partial with a full per-channel breakdown when channels disagree', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'failed', reason: 'no_phone' });
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]));

    const result = await notifier.notify(REQUEST);

    expect(result.status).toBe('partial');
    expect(result.channels).toEqual({ email: { status: 'sent' }, sms: { status: 'failed', reason: 'no_phone' } });
  });

  it('fails closed with no_channel_configured when nothing is configured for this notificationType', async () => {
    const notifier = new Notifier(fakeConfig([]), new Map());

    await expect(notifier.notify(REQUEST)).resolves.toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
  });

  it('treats a configured channel with no registered sender as a per-channel failure, not a crash', async () => {
    const email = fakeSender({ status: 'sent' });
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email]]));

    const result = await notifier.notify(REQUEST);

    expect(result.status).toBe('partial');
    expect(result.channels?.sms).toEqual({ status: 'failed', reason: 'channel_not_registered' });
  });

  it('never throws when a sender itself throws — backstopped into a per-channel failure', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = throwingSender(new Error('provider timeout'));
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]));

    const result = await notifier.notify(REQUEST);

    expect(result.status).toBe('partial');
    expect(result.channels?.sms).toEqual({ status: 'failed', reason: 'provider timeout' });
  });

  it('only calls the channels the policy selects, not every registered sender', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'sent' });
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', email], ['sms', sms]]));

    await notifier.notify(REQUEST);

    expect(sms.send).not.toHaveBeenCalled();
  });

  it('never throws when the channel config itself throws — backstopped the same as a sender', async () => {
    const notifier = new Notifier(throwingConfig(new Error('db connection lost')), new Map());

    await expect(notifier.notify(REQUEST)).resolves.toEqual({
      status: 'failed',
      reason: 'db connection lost',
      channels: {},
    });
  });

  it('passes request.tenantId through to channelConfig.channelsFor()', async () => {
    const config = fakeConfig(['email']);
    const email = fakeSender({ status: 'sent' });
    const notifier = new Notifier(config, new Map([['email', email]]));

    await notifier.notify({ ...REQUEST, tenantId: 't1' });

    expect(config.channelsFor).toHaveBeenCalledWith('invoice.sent', 't1');
  });

  it('defaults to null when the request has no tenantId', async () => {
    const config = fakeConfig(['email']);
    const email = fakeSender({ status: 'sent' });
    const notifier = new Notifier(config, new Map([['email', email]]));

    await notifier.notify(REQUEST);

    expect(config.channelsFor).toHaveBeenCalledWith('invoice.sent', null);
  });
});

describe('Notifier.notifyCritical', () => {
  it('strict=false (default): does not throw when at least one channel sent', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'failed', reason: 'no_phone' });
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]));

    await expect(notifier.notifyCritical(REQUEST)).resolves.toMatchObject({ status: 'partial' });
  });

  it('strict=false (default): throws when every channel failed', async () => {
    const email = fakeSender({ status: 'failed', reason: 'no_email' });
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', email]]));

    await expect(notifier.notifyCritical(REQUEST)).rejects.toBeInstanceOf(NotificationDeliveryError);
  });

  it('strict=true: throws when any channel failed, even if others sent', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'failed', reason: 'no_phone' });
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]));

    await expect(notifier.notifyCritical(REQUEST, true)).rejects.toBeInstanceOf(NotificationDeliveryError);
  });

  it('strict=true: does not throw when every channel sent', async () => {
    const email = fakeSender({ status: 'sent' });
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', email]]));

    await expect(notifier.notifyCritical(REQUEST, true)).resolves.toMatchObject({ status: 'sent' });
  });

  it('the thrown error carries the full NotificationResult for the caller to inspect', async () => {
    const email = fakeSender({ status: 'failed', reason: 'no_email' });
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', email]]));

    try {
      await notifier.notifyCritical(REQUEST);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NotificationDeliveryError);
      expect((err as NotificationDeliveryError).result).toEqual({
        status: 'failed',
        channels: { email: { status: 'failed', reason: 'no_email' } },
      });
    }
  });

  it('a channel config failure surfaces as NotificationDeliveryError too, not a raw error', async () => {
    const notifier = new Notifier(throwingConfig(new Error('db connection lost')), new Map());

    try {
      await notifier.notifyCritical(REQUEST);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NotificationDeliveryError);
      expect((err as NotificationDeliveryError).result).toEqual({
        status: 'failed',
        reason: 'db connection lost',
        channels: {},
      });
    }
  });
});

describe('Notifier — delivery log', () => {
  function fakeRecorder() {
    return { recordAttempts: vi.fn().mockResolvedValue(undefined), updateDeliveryStatus: vi.fn() };
  }

  it('records one attempt per channel with the redacted recipient and per-channel outcome', async () => {
    const recorder = fakeRecorder();
    const notifier = new Notifier(
      fakeConfig(['email', 'sms']),
      new Map([
        ['email', fakeSender({ status: 'sent', providerMessageId: 'ses-1' })],
        ['sms', fakeSender({ status: 'failed', reason: 'no_phone' })],
      ]),
      recorder,
    );

    await notifier.notify({ recipient: { type: 'user', id: 'u-42' }, notificationType: 'invoice.sent', variables: {}, tenantId: 't1' });

    expect(recorder.recordAttempts).toHaveBeenCalledTimes(1);
    const attempts = recorder.recordAttempts.mock.calls[0][0];
    expect(attempts).toHaveLength(2);
    expect(attempts).toContainEqual(expect.objectContaining({
      channel: 'email', notificationType: 'invoice.sent', tenantId: 't1',
      recipientRef: 'user:u-42', status: 'sent', providerMessageId: 'ses-1',
    }));
    expect(attempts).toContainEqual(expect.objectContaining({ channel: 'sms', status: 'failed', reason: 'no_phone' }));
  });

  it('redacts a raw recipient to raw:email / raw:phone / raw — never the address', async () => {
    const recorder = fakeRecorder();
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', fakeSender({ status: 'sent' })]]), recorder);

    await notifier.notify({ recipient: { type: 'raw', email: 'secret@x.com' }, notificationType: 'x', variables: {} });
    expect(recorder.recordAttempts.mock.calls[0][0][0].recipientRef).toBe('raw:email');
  });

  it('a recorder that throws is logged, never propagated — notify() still returns its result', async () => {
    const recorder = { recordAttempts: vi.fn().mockRejectedValue(new Error('log db down')), updateDeliveryStatus: vi.fn() };
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', fakeSender({ status: 'sent' })]]), recorder);

    await expect(notifier.notify(REQUEST)).resolves.toMatchObject({ status: 'sent' });
  });

  it('does not record when channel config resolution fails (nothing was attempted)', async () => {
    const recorder = fakeRecorder();
    const notifier = new Notifier(throwingConfig(new Error('boom')), new Map(), recorder);

    await notifier.notify(REQUEST);
    expect(recorder.recordAttempts).not.toHaveBeenCalled();
  });
});
