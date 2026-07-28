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
  /** Present when more than one channel was involved (i.e. returned by Notifier). */
  channels?: Partial<Record<NotificationChannel, NotificationChannelResult>>;
}
