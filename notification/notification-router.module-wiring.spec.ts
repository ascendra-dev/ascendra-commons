import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotificationRouter } from './notification-router';
import { StaticNotificationChannelPolicy } from './notification-channel-policy';
import { LogNotificationSender } from './log-notification-sender';
import { InMemoryNotificationLogStore } from './notification-log-store';
import { EmailNotificationSender, EmailClient, UserContactResolver } from './email-notification-sender';
import { NotificationTemplateRepository } from './notification-template';
import { NotificationChannel, NotificationSender } from './notification.types';
import {
  NOTIFICATION_LOG_STORE,
  EMAIL_CLIENT,
  USER_CONTACT_RESOLVER,
  NOTIFICATION_TEMPLATE_REPOSITORY,
  NOTIFICATION_CHANNEL_CONFIG,
  NOTIFICATION_CHANNEL_POLICY,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFICATION_SENDER,
} from './tokens';

/**
 * Mirrors exactly what a consumer's own AppNotificationModule would assemble
 * (see this folder's README) — real Nest DI, not manually constructed classes.
 * This is the shape of bug that only shows up when a container actually boots:
 * a missing binding, a useFactory `inject` list out of order, a useExisting
 * loop — none of which a plain unit test constructing classes with `new` can
 * catch.
 */
async function buildTestModule() {
  return Test.createTestingModule({
    providers: [
      { provide: NOTIFICATION_LOG_STORE, useClass: InMemoryNotificationLogStore },
      LogNotificationSender,

      { provide: EMAIL_CLIENT, useValue: { send: vi.fn().mockResolvedValue(undefined) } satisfies EmailClient },
      { provide: USER_CONTACT_RESOLVER, useValue: { findById: vi.fn() } satisfies UserContactResolver },
      {
        provide: NOTIFICATION_TEMPLATE_REPOSITORY,
        useValue: {
          findByEventType: vi.fn().mockResolvedValue({ eventType: 'payment.overdue.reminder', subject: 'Reminder', body: 'Pay up' }),
        } satisfies NotificationTemplateRepository,
      },
      EmailNotificationSender,

      { provide: NOTIFICATION_CHANNEL_CONFIG, useValue: { 'payment.overdue.reminder': ['email', 'log'] } },
      StaticNotificationChannelPolicy,
      { provide: NOTIFICATION_CHANNEL_POLICY, useExisting: StaticNotificationChannelPolicy },

      {
        provide: NOTIFICATION_CHANNEL_SENDERS,
        useFactory: (log: LogNotificationSender, email: EmailNotificationSender) =>
          new Map<NotificationChannel, NotificationSender>([
            ['log', log],
            ['email', email],
          ]),
        inject: [LogNotificationSender, EmailNotificationSender],
      },

      NotificationRouter,
      { provide: NOTIFICATION_SENDER, useExisting: NotificationRouter },
    ],
  }).compile();
}

describe('NotificationRouter — real consumer-style module wiring', () => {
  it('resolves NOTIFICATION_SENDER to the router and delivers through both real channels', async () => {
    const moduleRef = await buildTestModule();
    const sender = moduleRef.get<NotificationSender>(NOTIFICATION_SENDER);
    const emailClient = moduleRef.get<EmailClient>(EMAIL_CLIENT);
    const logStore = moduleRef.get<InMemoryNotificationLogStore>(NOTIFICATION_LOG_STORE);

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      eventType: 'payment.overdue.reminder',
      variables: {},
    });

    expect(result.status).toBe('sent');
    // The log channel's own honesty ("recorded, not actually delivered") survives
    // all the way through the router's per-channel breakdown, unmodified.
    expect(result.channels).toEqual({
      email: { status: 'sent' },
      log: { status: 'sent', reason: 'recorded_only_not_delivered' },
    });
    expect(emailClient.send).toHaveBeenCalledOnce();
    expect(logStore.list()).toHaveLength(1);
  });

  it('resolves to failed with no_channel_configured for an event type nobody configured', async () => {
    const moduleRef = await buildTestModule();
    const sender = moduleRef.get<NotificationSender>(NOTIFICATION_SENDER);

    const result = await sender.send({
      recipient: { type: 'raw', email: 'payer@example.com' },
      eventType: 'invoice.sent', // not in NOTIFICATION_CHANNEL_CONFIG above
      variables: {},
    });

    expect(result).toEqual({ status: 'failed', reason: 'no_channel_configured', channels: {} });
  });
});
