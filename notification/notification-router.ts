import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationChannelResult,
  NotificationRequest,
  NotificationResult,
  NotificationSender,
} from './notification.types';
import { NotificationChannelPolicy } from './notification-channel-policy';
import { NOTIFICATION_CHANNEL_POLICY, NOTIFICATION_CHANNEL_SENDERS } from './tokens';

/**
 * Implements the same NotificationSender interface every leaf sender does — a
 * caller of send() cannot tell whether it's talking to one channel or several.
 * Internally: ask the policy which channel(s) this eventType uses, dispatch to
 * each channel's own sender in parallel, aggregate.
 *
 * Aggregation rule: 'sent' only if every attempted channel sent; 'failed' only
 * if every attempted channel failed; 'partial' otherwise. The full per-channel
 * breakdown is always present in `channels`, so a caller that only checks
 * `status` gets a safe, honest answer, and one that wants to know exactly which
 * channel failed can look.
 */
@Injectable()
export class NotificationRouter implements NotificationSender {
  constructor(
    @Inject(NOTIFICATION_CHANNEL_POLICY) private readonly policy: NotificationChannelPolicy,
    @Inject(NOTIFICATION_CHANNEL_SENDERS) private readonly channelSenders: Map<NotificationChannel, NotificationSender>,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationResult> {
    const channels = await this.policy.channelsFor(request.eventType);

    if (channels.length === 0) {
      return { status: 'failed', reason: 'no_channel_configured', channels: {} };
    }

    const entries = await Promise.all(
      channels.map((channel): Promise<[NotificationChannel, NotificationChannelResult]> => this.dispatch(channel, request)),
    );

    const channelResults = Object.fromEntries(entries) as Partial<Record<NotificationChannel, NotificationChannelResult>>;
    const sentCount = entries.filter(([, result]) => result.status === 'sent').length;

    const status: NotificationResult['status'] =
      sentCount === entries.length ? 'sent' : sentCount === 0 ? 'failed' : 'partial';

    return { status, channels: channelResults };
  }

  private async dispatch(
    channel: NotificationChannel,
    request: NotificationRequest,
  ): Promise<[NotificationChannel, NotificationChannelResult]> {
    const sender = this.channelSenders.get(channel);
    if (!sender) {
      return [channel, { status: 'failed', reason: 'channel_not_registered' }];
    }

    const result = await sender.send(request);
    // A leaf sender should only ever return 'sent'/'failed' — coerced defensively
    // in case a registered channel sender is itself a composed router.
    return [channel, { status: result.status === 'sent' ? 'sent' : 'failed', reason: result.reason }];
  }
}
