import { Module } from '@nestjs/common';
import { NOTIFICATION_LOG_STORE, NOTIFICATION_SENDER } from './tokens';
import { InMemoryNotificationLogStore } from './notification-log-store';
import { LogNotificationSender } from './log-notification-sender';

/**
 * Batteries-included for the log-only path — no consumer-supplied bindings
 * needed. EmailNotificationSender is NOT wired here: it needs a real EmailClient,
 * UserContactResolver, and NotificationTemplateRepository that only the
 * consuming project can provide. See this folder's README for how to bind those
 * and register EmailNotificationSender in the consumer's own module once real
 * delivery is needed.
 *
 * NOTIFICATION_SENDER is bound via useExisting, not useClass — LogNotificationSender
 * is already constructed as its own provider below; useExisting reuses that same
 * instance under the second token rather than building a redundant second one.
 */
@Module({
  providers: [
    { provide: NOTIFICATION_LOG_STORE, useClass: InMemoryNotificationLogStore },
    LogNotificationSender,
    { provide: NOTIFICATION_SENDER, useExisting: LogNotificationSender },
  ],
  exports: [LogNotificationSender, NOTIFICATION_SENDER],
})
export class NotificationModule {}
