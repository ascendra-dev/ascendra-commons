import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotificationModule } from './notification.module';
import { LogNotificationSender } from './log-notification-sender';
import { InMemoryNotificationLogStore } from './notification-log-store';
import { NOTIFICATION_LOG_STORE, NOTIFICATION_SENDER } from './tokens';

describe('NotificationModule', () => {
  it('resolves NOTIFICATION_SENDER to the same instance as LogNotificationSender', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [NotificationModule] }).compile();

    const viaToken = moduleRef.get(NOTIFICATION_SENDER);
    const viaClass = moduleRef.get(LogNotificationSender);

    // useExisting must resolve to the exact same instance, not a second one —
    // otherwise NOTIFICATION_LOG_STORE writes would only be visible through one path.
    expect(viaToken).toBe(viaClass);
  });

  it('actually delivers a send() call through the token, end to end', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [NotificationModule] }).compile();

    const sender = moduleRef.get(NOTIFICATION_SENDER);
    const store = moduleRef.get<InMemoryNotificationLogStore>(NOTIFICATION_LOG_STORE);

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      eventType: 'invoice.voided',
      variables: {},
    });

    expect(result.status).toBe('sent');
    expect(store.list()).toHaveLength(1);
  });
});
