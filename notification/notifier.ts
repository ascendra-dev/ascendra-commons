import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationChannelResult,
  NotificationRequest,
  NotificationResult,
} from './notification.types';
import { NotificationChannelConfig } from './notification-channel-config';
import { NotificationSender } from './notification-sender';
import { NOTIFICATION_CHANNEL_CONFIG, NOTIFICATION_CHANNEL_SENDERS } from './tokens';

/** Carries the full NotificationResult so a caller catching this can still see per-channel detail. */
export class NotificationDeliveryError extends Error {
  constructor(public readonly result: NotificationResult) {
    super(`Notification delivery ${result.status}`);
  }
}

/**
 * A class, not an interface — this has exactly one implementation with real
 * behavior worth having directly. notify() retrieves the configured channels,
 * calls send() on each one's registered NotificationSender in parallel, and
 * aggregates: 'sent' only if every channel sent, 'failed' only if every
 * channel failed, 'partial' otherwise — always with the full per-channel
 * breakdown attached in `channels`, so a caller checking only `status` gets a
 * safe answer and one that wants to know exactly which channel failed can look.
 */
@Injectable()
export class Notifier {
  constructor(
    @Inject(NOTIFICATION_CHANNEL_CONFIG) private readonly channelConfig: NotificationChannelConfig,
    @Inject(NOTIFICATION_CHANNEL_SENDERS) private readonly senders: Map<NotificationChannel, NotificationSender>,
  ) {}

  async notify(request: NotificationRequest): Promise<NotificationResult> {
    let channels: NotificationChannel[];
    try {
      channels = await this.channelConfig.channelsFor(request.notificationType);
    } catch (err) {
      // Backstop for a NotificationChannelConfig implementation that can fail
      // (e.g. a database-backed one) — notify()'s "never throws" contract has
      // to hold here too, not just inside dispatch()'s per-channel calls.
      return {
        status: 'failed',
        reason: err instanceof Error ? err.message : 'channel_config_unavailable',
        channels: {},
      };
    }

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

  /**
   * Like notify(), but can throw — the emitCritical() counterpart to notify()'s
   * emit()-like "never throw" contract. Reuses notify() rather than duplicating
   * dispatch/aggregation; only the throw decision is new here.
   *
   * strict = false (default): throws only when every configured channel
   * failed — as long as at least one channel got through, this returns
   * normally instead of throwing.
   * strict = true: throws when any configured channel failed — only a fully
   * 'sent' result returns normally.
   *
   * Either way, when it throws, the exception carries the full NotificationResult
   * (see NotificationDeliveryError) so a caller that wants the per-channel
   * detail can still read it, even though delivery is being surfaced as a failure.
   */
  async notifyCritical(request: NotificationRequest, strict = false): Promise<NotificationResult> {
    const result = await this.notify(request);
    const shouldThrow = strict ? result.status !== 'sent' : result.status === 'failed';
    if (shouldThrow) {
      throw new NotificationDeliveryError(result);
    }
    return result;
  }

  private async dispatch(
    channel: NotificationChannel,
    request: NotificationRequest,
  ): Promise<[NotificationChannel, NotificationChannelResult]> {
    const sender = this.senders.get(channel);
    if (!sender) {
      return [channel, { status: 'failed', reason: 'channel_not_registered' }];
    }

    try {
      const result = await sender.send(request);
      return [channel, result];
    } catch (err) {
      // Backstop for a sender that forgot to catch its own error — the same
      // lesson as domain-events' emit(): one channel's exception must never
      // crash the whole notify() dispatch.
      return [channel, { status: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' }];
    }
  }
}
