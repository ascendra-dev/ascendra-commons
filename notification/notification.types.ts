/**
 * A 'user' recipient (issuer staff, platform admin) has a stored profile to resolve
 * contact info from. A 'raw' recipient (typically a payer/guest) has no account at
 * all — the caller supplies contact info directly, because it exists nowhere but
 * the entity that raised the event (e.g. the invoice). At least one of email/phone
 * is required for 'raw' — validate this at your own DTO boundary, not just here.
 */
export type NotificationRecipient =
  | { type: 'user'; id: string }
  | { type: 'raw'; email?: string; phone?: string };

export interface NotificationRequest {
  recipient: NotificationRecipient;
  eventType: string; // e.g. 'invoice.sent', 'payment.confirmed'
  variables: Record<string, string | number>;
}

/**
 * A single channel — one entry in the set NotificationRouter can fan out to.
 * Adding a real channel (e.g. WhatsApp) means adding it here, building a
 * NotificationSender implementation for it, and registering it where a
 * consumer assembles its NOTIFICATION_CHANNEL_SENDERS map — nothing about
 * NotificationRouter itself changes.
 */
export type NotificationChannel = 'email' | 'log';

/** A single channel's own outcome — always binary; only the aggregate above can be 'partial'. */
export interface NotificationChannelResult {
  status: 'sent' | 'failed';
  reason?: string;
}

export interface NotificationResult {
  status: 'sent' | 'partial' | 'failed';
  reason?: string;
  /**
   * Present when this result came from NotificationRouter fanning out to more
   * than one channel — one entry per channel attempted. Absent from a
   * single-channel sender's own result (LogNotificationSender,
   * EmailNotificationSender): those only ever return 'sent' or 'failed', never
   * 'partial', and have nothing to break down.
   */
  channels?: Partial<Record<NotificationChannel, NotificationChannelResult>>;
}

/**
 * Feature code never calls this directly — it raises a domain event, and a
 * listener depending only on this interface reacts to it (see the domain-events
 * pattern). This keeps notification logic, and its test surface, fully separate
 * from business logic.
 */
export interface NotificationSender {
  send(request: NotificationRequest): Promise<NotificationResult>;
}
