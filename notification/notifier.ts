/**
 * A 'user' recipient (issuer staff, platform admin) has a stored profile to resolve
 * contact info from. A 'raw' recipient (typically a payer/guest) has no account at
 * all — the caller supplies contact info directly, because it exists nowhere but
 * the entity that raised the event (e.g. the invoice).
 */
export type NotificationRecipient =
  | { type: 'user'; id: string }
  | { type: 'raw'; email?: string; phone?: string };

export interface NotificationRequest {
  recipient: NotificationRecipient;
  /**
   * Which template/channel configuration this specific notification uses — not
   * necessarily the domain event's own name. Often the same string (e.g.
   * 'invoice.sent' triggering a notification of the same name), but not
   * required to be: the same domain event can drive two different
   * notificationType values for two different audiences.
   *
   * Examples:
   * - 'invoice.sent'            — payer notified their invoice is ready to pay
   * - 'payment.confirmed'       — payer notified their payment was received
   * - 'invoice.voided.payer'    — payer notified an invoice they owed was cancelled
   * - 'invoice.voided.internal' — same underlying invoice.voided event, but a
   *                                different audience/template/channels entirely
   * - 'payment.overdue.reminder' — a Dues Notice, not tied 1:1 to any single
   *                                 domain event (raised on a schedule, not on a
   *                                 state change)
   */
  notificationType: string;
  variables: Record<string, string | number>;
}

/**
 * A channel identity is fixed and business-driven from day one — it does not
 * change when a channel's delivery mechanism goes from stub to real.
 */
export type NotificationChannel = 'email' | 'whatsapp' | 'sms';

/** A single channel's own outcome — always binary; only the aggregate below can be 'partial'. */
export interface NotificationChannelResult {
  status: 'sent' | 'failed';
  reason?: string;
}

export interface NotificationResult {
  status: 'sent' | 'partial' | 'failed';
  reason?: string;
  /** Present when more than one channel was involved (i.e. returned by NotifierRouter). */
  channels?: Partial<Record<NotificationChannel, NotificationChannelResult>>;
}

/**
 * Which channel(s) a notificationType uses — data, not code. Adding a new
 * notification type or changing its channels is editing this mapping, not
 * adding an if/else branch anywhere. An unconfigured notificationType resolves
 * to an empty array — fails closed and visibly, rather than guessing a default
 * channel that might be wrong.
 */
export class NotificationChannelConfig {
  constructor(private readonly config: Record<string, NotificationChannel[]>) {}

  async channelsFor(notificationType: string): Promise<NotificationChannel[]> {
    return this.config[notificationType] ?? [];
  }
}

/**
 * A template for one notificationType, within one channel's own repository.
 * subject and isHtml are email-only — SMS's own templates just leave them
 * unset, since SMS has no subject line and no HTML concept. WhatsApp does not
 * use this shape at all: its templates are pre-approved and named on Meta's
 * side, with positional numbered parameters, not text this library renders —
 * that's a separate shape for a later piece.
 */
export interface NotificationTemplate {
  subject?: string;
  body: string;
  isHtml?: boolean;
}

/**
 * Which text a notificationType uses for one channel — data, not code, same
 * reasoning as NotificationChannelConfig. Each channel gets its own instance
 * (see EmailNotificationSender/SMSNotificationSender below) even though both
 * share this same class, since each channel maintains its own templates.
 */
export class NotificationTemplateRepository {
  constructor(private readonly templates: Record<string, NotificationTemplate>) {}

  async templateFor(notificationType: string): Promise<NotificationTemplate | null> {
    return this.templates[notificationType] ?? null;
  }
}

/**
 * Missing variables are left as visible, unresolved {{placeholders}} rather
 * than silently blanked — a blank subject/body reads as "working," a visible
 * placeholder is obviously wrong and gets noticed before it reaches a user.
 */
export function renderTemplate(
  template: NotificationTemplate,
  variables: Record<string, string | number>,
): { subject?: string; body: string; isHtml?: boolean } {
  const interpolate = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = variables[key];
      return value === undefined ? match : String(value);
    });

  return {
    subject: template.subject ? interpolate(template.subject) : undefined,
    body: interpolate(template.body),
    isHtml: template.isHtml,
  };
}

/**
 * A class, not an interface — same reasoning as Notifier. send() returns
 * NotificationChannelResult, never the full NotificationResult: a single
 * channel's own outcome is always binary, and 'partial' only ever means
 * something once more than one channel's result has been combined, which is
 * Notifier's job, not this one's.
 *
 * Base implementation is a stub, like Notifier's own notify() — real delivery
 * logic is a later piece.
 */
export class NotificationSender {
  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    console.log(request);
    return { status: 'sent' };
  }
}

export class EmailNotificationSender extends NotificationSender {
  constructor(private readonly templates: NotificationTemplateRepository) {
    super();
  }

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const template = await this.templates.templateFor(request.notificationType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    console.log('email', rendered);
    return { status: 'sent' };
  }
}

export class WhatsappNotificationSender extends NotificationSender {
  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    console.log('whatsapp', request);
    return { status: 'sent' };
  }
}

export class SMSNotificationSender extends NotificationSender {
  constructor(private readonly templates: NotificationTemplateRepository) {
    super();
  }

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const template = await this.templates.templateFor(request.notificationType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    console.log('sms', rendered);
    return { status: 'sent' };
  }
}

/**
 * A class, not an interface. notify() retrieves the configured channels, calls
 * send() on each one's registered NotificationSender in parallel, and
 * aggregates: 'sent' only if every channel sent, 'failed' only if every
 * channel failed, 'partial' otherwise — always with the full per-channel
 * breakdown attached in `channels`, so a caller checking only `status` gets a
 * safe answer and one that wants to know exactly which channel failed can look.
 */
export class Notifier {
  constructor(
    private readonly channelConfig: NotificationChannelConfig,
    private readonly senders: Map<NotificationChannel, NotificationSender>,
  ) {}

  async notify(request: NotificationRequest): Promise<NotificationResult> {
    const channels = await this.channelConfig.channelsFor(request.notificationType);

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

/** Carries the full NotificationResult so a caller catching this can still see per-channel detail. */
export class NotificationDeliveryError extends Error {
  constructor(public readonly result: NotificationResult) {
    super(`Notification delivery ${result.status}`);
  }
}
