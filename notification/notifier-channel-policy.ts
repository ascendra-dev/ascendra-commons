import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannel } from './notifier';
import { NOTIFIER_CHANNEL_CONFIG } from './tokens';

export interface NotifierChannelPolicy {
  channelsFor(eventType: string): Promise<NotificationChannel[]>;
}

export type NotifierChannelConfig = Record<string, NotificationChannel[]>;

/**
 * Data, not code — the same discipline notification-template.ts already applies
 * to templates, extended to channel selection: which channel(s) an event type
 * uses is a config row (`{ 'invoice.sent': ['email'], 'payment.overdue.reminder':
 * ['email', 'whatsapp'] }`), not an if/else per event type. This is the business
 * decision "what channels does this event use" — independent of whether each
 * channel's transport is currently a stub or real.
 *
 * An event type with no entry resolves to zero channels — fails closed and
 * visibly (NotifierRouter reports 'no_channel_configured') rather than guessing.
 *
 * Model 1: a plain static object, bound via NOTIFIER_CHANNEL_CONFIG. Model 2
 * (future target): a DB-backed policy implementing the same interface, once a
 * project needs non-developers to manage this without a deploy.
 */
@Injectable()
export class StaticNotifierChannelPolicy implements NotifierChannelPolicy {
  constructor(@Inject(NOTIFIER_CHANNEL_CONFIG) private readonly config: NotifierChannelConfig) {}

  async channelsFor(eventType: string): Promise<NotificationChannel[]> {
    return this.config[eventType] ?? [];
  }
}
