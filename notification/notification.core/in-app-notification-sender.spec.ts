import { describe, expect, it, vi } from 'vitest';
import { InAppNotificationSender } from './in-app-notification-sender';
import type { NotificationConfig } from './notification-config.port';

const config = (template: unknown = { subject: 'Invoice {{n}} is due', body: 'Pay {{amount}} by Friday' }) =>
  ({ channelsFor: vi.fn(), templateFor: vi.fn().mockResolvedValue(template), providerConfigFor: vi.fn() }) as unknown as NotificationConfig;
const request = { recipient: { type: 'user' as const, id: 'u1' }, notificationType: 'invoice.due', variables: { n: 'INV-1', amount: '40' }, tenantId: 't1' };

describe('InAppNotificationSender', () => {
  it("renders the in_app template into the user's inbox — the subject is the title; no credential needed", async () => {
    const inbox = { deliver: vi.fn().mockResolvedValue('42') };
    const c = config();
    const result = await new InAppNotificationSender(c, inbox).send(request);
    expect(result).toMatchObject({ status: 'sent', providerMessageId: 'inbox:42' });
    expect(inbox.deliver).toHaveBeenCalledWith({
      userId: 'u1', tenantId: 't1', notificationType: 'invoice.due', title: 'Invoice INV-1 is due', body: 'Pay 40 by Friday', correlationId: undefined,
    });
    expect(c.templateFor).toHaveBeenCalledWith('in_app', 'invoice.due', 't1');
    expect(c.providerConfigFor).not.toHaveBeenCalled();
  });

  it('a guest, no inbox bound, or no template — fails without throwing', async () => {
    const inbox = { deliver: vi.fn() };
    await expect(new InAppNotificationSender(config(), inbox).send({ ...request, recipient: { type: 'raw', email: 'a@b.c' } })).resolves.toEqual({
      status: 'failed', reason: 'no_user_recipient',
    });
    await expect(new InAppNotificationSender(config(), null).send(request)).resolves.toEqual({ status: 'failed', reason: 'no_inbox' });
    await expect(new InAppNotificationSender(config(null), inbox).send(request)).resolves.toEqual({ status: 'failed', reason: 'template_not_found' });
    expect(inbox.deliver).not.toHaveBeenCalled();
  });
});
