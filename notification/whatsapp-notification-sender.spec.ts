import { describe, expect, it } from 'vitest';
import { WhatsappNotificationSender } from './whatsapp-notification-sender';

describe('WhatsappNotificationSender', () => {
  it('is a stub that always reports sent — no template lookup or real delivery yet', async () => {
    const sender = new WhatsappNotificationSender();

    const result = await sender.send({
      recipient: { type: 'raw', phone: '+923001234567' },
      notificationType: 'invoice.sent',
      variables: {},
    });

    expect(result).toEqual({ status: 'sent' });
  });
});
