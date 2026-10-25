import { describe, expect, it, vi } from 'vitest';
import { NotificationRecipientHasher } from './recipient-hasher';
import { Notifier, NotificationDeliveryError } from './notifier';
import { NotificationConfig } from './notification-config.port';
import { NotificationChannel, NotificationChannelResult } from './notification.types';
import { NotificationSender } from './notification-sender.port';

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

  it('keys each attempt by user, or by the hash of the address that channel used — never the address', async () => {
    const recorder = fakeRecorder();
    const hasher = new NotificationRecipientHasher('a-test-secret-of-32-characters!!');
    const notifier = new Notifier(
      fakeConfig(['email', 'sms']),
      new Map([['email', fakeSender({ status: 'sent' })], ['sms', fakeSender({ status: 'sent' })]]),
      recorder,
      hasher,
    );
    await notifier.notify({ recipient: { type: 'raw', email: 'ada@example.com', phone: '+15550100' }, notificationType: 'x', variables: {} });
    const attempts = recorder.recordAttempts.mock.calls[0][0];
    expect(attempts.find((a: { channel: string }) => a.channel === 'email').recipientKey).toBe(hasher.hashEmail('ada@example.com'));
    expect(attempts.find((a: { channel: string }) => a.channel === 'sms').recipientKey).toBe(hasher.hashPhone('+15550100'));
    expect(JSON.stringify(attempts)).not.toContain('ada@');

    await notifier.notify({ recipient: { type: 'user', id: 'u1' }, notificationType: 'x', variables: {} });
    expect(recorder.recordAttempts.mock.calls[1][0][0].recipientKey).toBe('user:u1');
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

describe('Notifier — the suppression list', () => {
  const hasher = new NotificationRecipientHasher('a-test-secret-of-32-characters!!');
  const raw = { type: 'raw' as const, email: 'ada@example.com', phone: '+15550100' };

  it('skips a suppressed channel — not sent, not a failure — and sends the rest', async () => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'sent' });
    const suppressions = { isSuppressed: vi.fn(async (channel: string) => channel === 'email') };
    const notifier = new Notifier(fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]), undefined, hasher, suppressions);
    const result = await notifier.notify({ recipient: raw, notificationType: 'x', variables: {} });
    expect(result).toEqual({ status: 'sent', channels: { email: { status: 'skipped', reason: 'suppressed' }, sms: { status: 'sent' } } });
    expect(email.send).not.toHaveBeenCalled();
    expect(suppressions.isSuppressed).toHaveBeenCalledWith('email', hasher.hashEmail('ada@example.com'));
  });

  it('every channel skipped is a skipped notification — and notifyCritical does not throw for it', async () => {
    const suppressions = { isSuppressed: vi.fn().mockResolvedValue(true) };
    const notifier = new Notifier(fakeConfig(['email']), new Map([['email', fakeSender({ status: 'sent' })]]), undefined, hasher, suppressions);
    await expect(notifier.notify({ recipient: raw, notificationType: 'x', variables: {} })).resolves.toMatchObject({ status: 'skipped' });
    await expect(notifier.notifyCritical({ recipient: raw, notificationType: 'x', variables: {} }, true)).resolves.toMatchObject({ status: 'skipped' });
  });

  it('a broken list never stops a send; a guest without a hasher has no key to check', async () => {
    const broken = { isSuppressed: vi.fn().mockRejectedValue(new Error('db down')) };
    const sender = fakeSender({ status: 'sent' });
    await expect(
      new Notifier(fakeConfig(['email']), new Map([['email', sender]]), undefined, hasher, broken).notify({ recipient: raw, notificationType: 'x', variables: {} }),
    ).resolves.toMatchObject({ status: 'sent' });
    const list = { isSuppressed: vi.fn() };
    await new Notifier(fakeConfig(['email']), new Map([['email', sender]]), undefined, null, list).notify({ recipient: raw, notificationType: 'x', variables: {} });
    expect(list.isSuppressed).not.toHaveBeenCalled();
  });
});

describe('Notifier — dedupeKey', () => {
  const request = { recipient: { type: 'user' as const, id: 'u1' }, notificationType: 'invoice.sent', variables: {}, dedupeKey: 'invoice:INV-1:sent' };
  const make = (dedupe: unknown, sender = fakeSender({ status: 'sent' })) =>
    ({ sender, notifier: new Notifier(fakeConfig(['email']), new Map([['email', sender]]), undefined, null, null, dedupe as never, 60_000) });

  it('the first call claims the key, sends, and stores its result', async () => {
    const dedupe = { claim: vi.fn().mockResolvedValue({ claimed: true }), complete: vi.fn() };
    const { notifier, sender } = make(dedupe);
    const result = await notifier.notify(request);
    expect(dedupe.claim).toHaveBeenCalledWith('invoice:INV-1:sent', 60_000);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(dedupe.complete).toHaveBeenCalledWith('invoice:INV-1:sent', result);
  });

  it("a duplicate sends nothing and gets the first call's result — or skipped while it's still sending", async () => {
    const prior = { status: 'sent' as const, channels: { email: { status: 'sent' as const } } };
    const done = make({ claim: vi.fn().mockResolvedValue({ claimed: false, prior }), complete: vi.fn() });
    await expect(done.notifier.notify(request)).resolves.toBe(prior);
    expect(done.sender.send).not.toHaveBeenCalled();
    const inFlight = make({ claim: vi.fn().mockResolvedValue({ claimed: false, prior: null }), complete: vi.fn() });
    await expect(inFlight.notifier.notify(request)).resolves.toEqual({ status: 'skipped', reason: 'duplicate_in_flight', channels: {} });
  });

  it('a failing store never stops the send; no key, an oversized key, or no deduplicator — no claim', async () => {
    const broken = { claim: vi.fn().mockRejectedValue(new Error('db down')), complete: vi.fn().mockRejectedValue(new Error('db down')) };
    const { notifier, sender } = make(broken);
    await expect(notifier.notify(request)).resolves.toMatchObject({ status: 'sent' });
    expect(sender.send).toHaveBeenCalledTimes(1);
    const dedupe = { claim: vi.fn(), complete: vi.fn() };
    await make(dedupe).notifier.notify({ ...request, dedupeKey: undefined });
    await make(dedupe).notifier.notify({ ...request, dedupeKey: 'k'.repeat(257) });
    expect(dedupe.claim).not.toHaveBeenCalled();
    await expect(make(null).notifier.notify(request)).resolves.toMatchObject({ status: 'sent' });
  });
});

describe('Notifier — a user’s preferences', () => {
  const user = { type: 'user' as const, id: 'u1' };
  const prefs = (optedOut: string[]) => ({ isOptedOut: vi.fn(async (_u: string, _t: string, channel: string) => optedOut.includes(channel)) });
  const make = (preferences: unknown, types: unknown[] = []) => {
    const email = fakeSender({ status: 'sent' });
    const sms = fakeSender({ status: 'sent' });
    const notifier = new Notifier(
      fakeConfig(['email', 'sms']), new Map([['email', email], ['sms', sms]]), undefined, null, null, null, undefined,
      preferences as never, types as never,
    );
    return { notifier, email, sms };
  };

  it('skips a channel the user turned off — opted_out — and sends the rest', async () => {
    const { notifier, sms } = make(prefs(['sms']));
    const result = await notifier.notify({ recipient: user, notificationType: 'invoice.reminder', variables: {} });
    expect(result.channels).toEqual({ email: { status: 'sent' }, sms: { status: 'skipped', reason: 'opted_out' } });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('a required type always sends; a guest has no preferences; a broken store means send', async () => {
    const required = make(prefs(['email', 'sms']), [{ name: 'password.reset', required: true }]);
    await expect(required.notifier.notify({ recipient: user, notificationType: 'password.reset', variables: {} })).resolves.toMatchObject({ status: 'sent' });
    const p = prefs(['email', 'sms']);
    await make(p).notifier.notify({ recipient: { type: 'raw', email: 'a@b.c' }, notificationType: 'x', variables: {} });
    expect(p.isOptedOut).not.toHaveBeenCalled();
    const broken = make({ isOptedOut: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(broken.notifier.notify({ recipient: user, notificationType: 'x', variables: {} })).resolves.toMatchObject({ status: 'sent' });
  });
});
