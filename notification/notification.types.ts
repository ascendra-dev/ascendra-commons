/**
 * A 'user' recipient (issuer staff, platform admin) has a stored profile to resolve
 * contact info from. A 'raw' recipient (typically a payer/guest) has no account at
 * all — the caller supplies contact info directly, because it exists nowhere but
 * the entity that raised the event (e.g. the invoice). At least one of email/phone
 * is required for 'raw' — nothing in this type enforces that; a 'raw' recipient
 * with neither set simply resolves to a 'no_address_available' failure per
 * channel rather than being caught earlier, so validate at your own DTO
 * boundary if you want it rejected sooner.
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
  /**
   * Which tenant this notification is for — `null`/omitted for a
   * platform-wide notification with no single tenant. Threaded down to
   * `NotificationChannelConfig.channelsFor()` and
   * `NotificationTemplateRepository.templateFor()` so a database-backed
   * implementation can vary routing or content per tenant (e.g. tenant A
   * wants SMS+email for 'payment.confirmed', tenant B wants email only; a
   * white-labeled tenant has its own template). `StaticNotificationChannelConfig`
   * and `StaticNotificationTemplateRepository` ignore it — Model 1 is one
   * config for the whole deployment by design. Same reasoning as `Actor.tenantId`
   * in `authorization` — nullable because not every notification has a single
   * tenant, carried on the request the same way `Actor` carries it for `can()`.
   */
  tenantId?: string | null;
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
