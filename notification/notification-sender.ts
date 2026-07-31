import { NotificationChannelResult, NotificationRequest } from './notification.types';

/**
 * An interface — Email/WhatsApp/SMS share no behavior with each other, so
 * there's no shared base worth having; each implements this shape
 * independently. send() returns NotificationChannelResult, never the full
 * NotificationResult: a single channel's own outcome is always binary, and
 * 'partial' only ever means something once more than one channel's result
 * has been combined, which is Notifier's job, not this one's.
 */
export interface NotificationSender {
  send(request: NotificationRequest): Promise<NotificationChannelResult>;
}
