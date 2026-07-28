import { Module } from '@nestjs/common';
import { NOTIFICATION_LOG_STORE } from './tokens';
import { InMemoryNotificationLogStore } from './notification-log-store';
import { LogNotificationSender } from './log-notification-sender';

/**
 * Batteries-included for the log-only path — no consumer-supplied bindings
 * needed. EmailNotificationSender is NOT wired here: it needs a real EmailClient,
 * UserContactResolver, and NotificationTemplateRepository that only the
 * consuming project can provide. See this folder's README for how to bind those
 * and register EmailNotificationSender in the consumer's own module once real
 * delivery is needed.
 */
@Module({
  providers: [{ provide: NOTIFICATION_LOG_STORE, useClass: InMemoryNotificationLogStore }, LogNotificationSender],
  exports: [LogNotificationSender],
})
export class NotificationModule {}
