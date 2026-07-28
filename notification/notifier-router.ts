import { Inject, Injectable } from '@nestjs/common';
import {
  Notifier,
  NotificationChannel,
  NotificationChannelResult,
  NotificationRequest,
  NotificationResult,
} from './notifier';
import { NotifierChannelPolicy } from './notifier-channel-policy';
import { NOTIFIER_CHANNEL_POLICY, NOTIFIER_CHANNELS } from './tokens';

/**
 * Implements the same Notifier interface every channel does — a caller of
 * notify() cannot tell whether it's talking to one channel or several.
 * Internally: ask the policy which channel(s) this eventType uses, dispatch to
 * each channel's own Notifier in parallel, aggregate.
 *
 * Aggregation rule: 'sent' only if every attempted channel sent; 'failed' only
 * if every attempted channel failed; 'partial' otherwise — always with the full
 * per-channel breakdown in `channels`.
 */
@Injectable()
export class NotifierRouter implements Notifier {
  constructor(
    @Inject(NOTIFIER_CHANNEL_POLICY) private readonly policy: NotifierChannelPolicy,
    @Inject(NOTIFIER_CHANNELS) private readonly channels: Map<NotificationChannel, Notifier>,
  ) {}

  async notify(request: NotificationRequest): Promise<NotificationResult> {
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
    const notifier = this.channels.get(channel);
    if (!notifier) {
      return [channel, { status: 'failed', reason: 'channel_not_registered' }];
    }

    const result = await notifier.notify(request);
    // A channel notifier should only ever return 'sent'/'failed' — coerced
    // defensively in case a registered channel is itself a composed router.
    return [channel, { status: result.status === 'sent' ? 'sent' : 'failed', reason: result.reason }];
  }
}
