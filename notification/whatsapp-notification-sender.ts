import { Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRequest } from './notification.types';
import { NotificationSender } from './notification-sender';

/**
 * No template repository yet — WhatsApp's real templates are pre-approved and
 * named on Meta's side with positional numbered parameters, not text this
 * library renders the way email/SMS templates work. That's a distinct shape
 * for a later piece; this stays a stub until it's built.
 */
@Injectable()
export class WhatsappNotificationSender implements NotificationSender {
  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    console.log('whatsapp', request);
    return { status: 'sent' };
  }
}
