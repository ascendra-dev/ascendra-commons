import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EmailNotificationSender } from './email-notification-sender';
import { SMSNotificationSender } from './sms-notification-sender';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';
import type { NotificationConfig } from './notification-config.port';

afterEach(() => vi.restoreAllMocks());

const config: NotificationConfig = {
  channelsFor: vi.fn().mockResolvedValue(['email']),
  templateFor: vi.fn().mockResolvedValue({ subject: 'Invoice {{n}} for {{name}}', body: 'Hi {{name}}, you owe {{amount}}' }),
  providerConfigFor: vi.fn().mockResolvedValue({ apiKey: 'sk_live_secret' }),
};
const users = { findById: vi.fn() };
const request = {
  notificationType: 'invoice.sent',
  tenantId: 't1',
  variables: { n: 'INV-9', name: 'Ada Lovelace', amount: '4,820.00' },
  recipient: { type: 'raw' as const, email: 'ada@example.com', phone: '+15550100' },
};

describe('the stub senders log no personal data', () => {
  it.each([
    ['email', () => new EmailNotificationSender(config, users)],
    ['sms', () => new SMSNotificationSender(config, users)],
    ['whatsapp', () => new WhatsappNotificationSender(config)],
  ])('%s: a line naming the type and the redacted recipient — not the address, text, variables or secret', async (channel, make) => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await make().send(request);
    const written = JSON.stringify([...log.mock.calls, ...consoleLog.mock.calls]);
    expect(written).toContain(`[stub] ${channel} · invoice.sent · tenant t1 · to raw:email`);
    for (const secret of ['ada@example.com', '+15550100', 'Ada Lovelace', '4,820.00', 'INV-9', 'sk_live_secret', 'you owe']) {
      expect(written).not.toContain(secret);
    }
  });
});
