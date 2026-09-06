import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationChannelResult,
  NotificationRecipient,
  NotificationRequest,
  NotificationResult,
} from './notification.types';
import { NotificationConfig } from './notification-config';
import type { DeliveryAttempt, NotificationDeliveryRecorder } from './notification-delivery-recorder';
import { NoopNotificationDeliveryRecorder } from './noop-notification-delivery-recorder';
import { NotificationSender } from './notification-sender';
import { NOTIFICATION_CHANNEL_SENDERS, NOTIFICATION_CONFIG, NOTIFICATION_DELIVERY_RECORDER } from './tokens';

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
  private readonly logger = new Logger(Notifier.name);
  private readonly deliveryRecorder: NotificationDeliveryRecorder;

  constructor(
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    @Inject(NOTIFICATION_CHANNEL_SENDERS) private readonly senders: Map<NotificationChannel, NotificationSender>,
    @Optional() @Inject(NOTIFICATION_DELIVERY_RECORDER) deliveryRecorder?: NotificationDeliveryRecorder,
  ) {
    // NotificationModule.forRoot() always binds the token; the fallback keeps
    // `new Notifier(config, senders)` (tests, ad hoc wiring) working.
    this.deliveryRecorder = deliveryRecorder ?? new NoopNotificationDeliveryRecorder();
  }

  async notify(request: NotificationRequest): Promise<NotificationResult> {
    let channels: NotificationChannel[];
    try {
      channels = await this.config.channelsFor(request.notificationType, request.tenantId ?? null);
    } catch (err) {
      // Backstop for a NotificationConfig implementation that can fail (e.g. a
      // database-backed one) — notify()'s "never throws" contract has to hold
      // here too, not just inside dispatch()'s per-channel calls.
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

    await this.recordDelivery(request, entries);
    return { status, channels: channelResults };
  }

  /**
   * Best-effort — a failure to write the delivery log is swallowed and logged,
   * never allowed to change the notification's own outcome (contrast
   * audit-logging, where a failed write is critical). The recorder itself is
   * also contractually non-throwing; this is the belt-and-braces.
   */
  private async recordDelivery(
    request: NotificationRequest,
    entries: Array<[NotificationChannel, NotificationChannelResult]>,
  ): Promise<void> {
    const now = new Date();
    const attempts: DeliveryAttempt[] = entries.map(([channel, result]) => ({
      notificationType: request.notificationType,
      channel,
      tenantId: request.tenantId ?? null,
      recipientRef: recipientRef(request.recipient),
      status: result.status,
      reason: result.reason,
      providerMessageId: result.providerMessageId,
      attemptedAt: now,
      correlationId: request.correlationId,
    }));
    try {
      await this.deliveryRecorder.recordAttempts(attempts);
    } catch (err) {
      this.logger.error(
        `notify("${request.notificationType}") delivered, but recording the delivery log failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
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

/** Redacted recipient identity for the delivery log — never the actual address. */
function recipientRef(recipient: NotificationRecipient): string {
  if (recipient.type === 'user') return `user:${recipient.id}`;
  if (recipient.email) return 'raw:email';
  if (recipient.phone) return 'raw:phone';
  return 'raw';
}
