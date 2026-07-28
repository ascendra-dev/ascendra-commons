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
  eventType: string; // e.g. 'invoice.sent', 'payment.confirmed'
  variables: Record<string, string | number>;
}

/**
 * A channel identity is fixed and business-driven from day one — it does not
 * change when a channel's delivery mechanism goes from stub to real. Adding a
 * real channel later means adding it here and giving it a ChannelNotifier
 * configuration (see channel-notifier.ts); nothing about NotifierRouter changes.
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
 * The one method every notifier implements — a single channel and a router
 * fanning out to several both satisfy this same interface, so a caller of
 * notify() cannot tell which it's talking to.
 */
export interface Notifier {
  notify(request: NotificationRequest): Promise<NotificationResult>;
}
