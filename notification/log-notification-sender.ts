import { Inject, Injectable } from '@nestjs/common';
import { NotificationRequest, NotificationResult, NotificationSender } from './notification.types';
import { NOTIFICATION_LOG_STORE } from './tokens';
import { NotificationLogStore } from './notification-log-store';

/**
 * Records intent without sending anything — no email/SMS/WhatsApp provider, no
 * network dependency. Correct default for a project that generates shareable
 * content and lets the user distribute it manually, or hasn't picked a real
 * delivery channel yet. Swap for EmailNotificationSender (or another
 * NotificationSender implementation) once real delivery is actually needed —
 * same interface, no call-site changes.
 */
@Injectable()
export class LogNotificationSender implements NotificationSender {
  constructor(@Inject(NOTIFICATION_LOG_STORE) private readonly store: NotificationLogStore) {}

  async send(request: NotificationRequest): Promise<NotificationResult> {
    await this.store.record({ ...request, recordedAt: new Date() });
    // 'sent' here means "the pipeline completed" — not "a message left the
    // building." The reason field says so explicitly rather than leaving that
    // ambiguous for whoever reads this result later.
    return { status: 'sent', reason: 'recorded_only_not_delivered' };
  }
}
