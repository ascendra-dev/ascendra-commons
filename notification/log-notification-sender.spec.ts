import { describe, expect, it } from 'vitest';
import { LogNotificationSender } from './log-notification-sender';
import { InMemoryNotificationLogStore } from './notification-log-store';

describe('LogNotificationSender', () => {
  it('records the request and reports sent with a not-delivered reason', async () => {
    const store = new InMemoryNotificationLogStore();
    const sender = new LogNotificationSender(store);

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      eventType: 'invoice.sent',
      variables: { invoiceNumber: 'INV-001' },
    });

    expect(result).toEqual({ status: 'sent', reason: 'recorded_only_not_delivered' });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].eventType).toBe('invoice.sent');
    expect(store.list()[0].recordedAt).toBeInstanceOf(Date);
  });

  it('never actually delivers anything — no email/network dependency exists to call', async () => {
    const store = new InMemoryNotificationLogStore();
    const sender = new LogNotificationSender(store);

    await sender.send({ recipient: { type: 'raw', email: 'a@b.com' }, eventType: 'x', variables: {} });
    await sender.send({ recipient: { type: 'user', id: 'u1' }, eventType: 'y', variables: {} });

    expect(store.list()).toHaveLength(2);
  });
});
