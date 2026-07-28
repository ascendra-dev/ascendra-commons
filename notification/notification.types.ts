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

export type NotificationResult = { status: 'sent' | 'failed'; reason?: string };

/**
 * Feature code never calls this directly — it raises a domain event, and a
 * listener depending only on this interface reacts to it (see the domain-events
 * pattern). This keeps notification logic, and its test surface, fully separate
 * from business logic.
 */
export interface NotificationSender {
  send(request: NotificationRequest): Promise<NotificationResult>;
}
