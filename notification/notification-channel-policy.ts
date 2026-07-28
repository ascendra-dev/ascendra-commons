import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannel } from './notification.types';
import { NOTIFICATION_CHANNEL_CONFIG } from './tokens';

export interface NotificationChannelPolicy {
  channelsFor(eventType: string): Promise<NotificationChannel[]>;
}

export type NotificationChannelConfig = Record<string, NotificationChannel[]>;

/**
 * Data, not code — the same discipline notification-template.ts already applies
 * to templates, extended to channel selection: which channel(s) an event type
 * uses is a config row (`{ 'invoice.sent': ['email'], 'payment.overdue.reminder':
 * ['email', 'whatsapp'] }`), not an if/else per event type.
 *
 * An event type with no entry resolves to zero channels — fails closed and
 * visibly (NotificationRouter reports 'no_channel_configured') rather than
 * guessing a default that might silently be wrong.
 *
 * Model 1: a plain static object, bound via NOTIFICATION_CHANNEL_CONFIG. Model
 * 2 (future target): a DB-backed policy implementing the same interface, once a
 * project actually needs non-developers to manage this without a deploy.
 */
@Injectable()
export class StaticNotificationChannelPolicy implements NotificationChannelPolicy {
  constructor(@Inject(NOTIFICATION_CHANNEL_CONFIG) private readonly config: NotificationChannelConfig) {}

  async channelsFor(eventType: string): Promise<NotificationChannel[]> {
    return this.config[eventType] ?? [];
  }
}
