# Notification Pattern

## Overview

A project must inform users of events (invoice sent, payment received, reminders
due) without embedding notification logic in feature code, and without building a
full multi-channel delivery system before it's needed. This pattern defines
notifications as a standalone, swappable module triggered by domain events, never
called inline.

## The pattern

### `NotificationSender` — defined once, never the implementation

```typescript
export type NotificationRecipient =
  | { type: 'user'; id: string }
  | { type: 'raw'; email?: string; phone?: string };

export interface NotificationRequest {
  recipient: NotificationRecipient;
  eventType: string;
  variables: Record<string, string | number>;
}

export interface NotificationSender {
  send(request: NotificationRequest): Promise<{ status: 'sent' | 'failed'; reason?: string }>;
}
```

Feature code never calls `NotificationSender` directly — it raises a domain event
(see the `domain-events` pattern), and a listener depending only on this interface
reacts to it:

```typescript
// In a listener — see domain-events' README for the full raise/listen shape
@OnEvent(InvoiceEvents.SENT)
async onInvoiceSent(event: InvoiceSent) {
  await this.notifications.send({
    recipient: { type: 'raw', email: event.payerEmail },
    eventType: 'invoice.sent',
    variables: { invoiceNumber: event.invoiceNumber, amount: event.amount },
  });
}
```

Call this from a listener registered via `domainEvents.emit()` (best-effort), or
have the listener itself catch its own errors if it shares an event name with a
must-not-fail listener — see the domain-events pattern's reliability-tiering
section for why that distinction matters.

### Templates are data, not code

A lookup table maps `eventType -> { subject, body }` with `{{variable}}`
placeholders (`renderTemplate`, shipped here), so adding a new event type is a
data row in the consuming project's own store, not a code change.

## Implementations

- **`LogNotificationSender`** — records intent without sending anything. Backed by
  `NotificationLogStore`; ships with `InMemoryNotificationLogStore` (zero external
  dependency) and wired into `NotificationModule` out of the box.
- **`EmailNotificationSender`** — one real email channel. Needs three bindings
  only the consuming project can supply: `EmailClient` (thin wrapper over whatever
  provider is actually used), `UserContactResolver` (resolves a `'user'`
  recipient against the project's own user/issuer/staff table), and
  `NotificationTemplateRepository` (the project's own template storage).
- Future adapters (SMS, WhatsApp, push) — added only when a specific story
  requires them, each satisfying the same `NotificationSender` interface.

Both implementations satisfy the same interface — swapping one for the other at
the call site is a one-line provider change, never a call-site change.

## Model 1 — Trivial Adapter, Two Interchangeable Options (current)

Which Model 1 option a project actually binds is a project-specific decision, not
a fact about this pattern: some projects generate shareable content and let the
user distribute it manually (bind `LogNotificationSender`); others need real
delivery from day one (bind `EmailNotificationSender`). Both are legitimate
"Model 1" — this library doesn't presume which one any given consumer needs.

Do not build end-to-end tests against a real delivery provider until that channel
is actually load-bearing in production — unit-test the sender against a fake
`EmailClient`/`UserContactResolver`/`NotificationTemplateRepository` instead, as
this module's own `.spec.ts` files do.

## Model 2 — Multi-Channel, Tracked Delivery (future target)

Additional channel adapters (SMS, WhatsApp, push) behind the same
`NotificationSender` interface, resolved by a `NotificationRouter implements
NotificationSender` that holds one sender per channel and delegates by the
recipient's stored channel preference (`'user'`) or a per-`eventType` default
policy (`'raw'`, where there's no stored preference to read). Everything upstream
is unchanged. Build only once a specific story requires a given channel — not
speculatively.

## Consuming this module

Copy the `notification/` folder verbatim into the consumer project's `src/`.

For the log-only path, import `NotificationModule` as-is — no bindings needed:

```typescript
@Module({ imports: [NotificationModule] })
export class AppModule {}
```

For real email delivery, bind the three tokens in the consumer's own module
alongside `EmailNotificationSender`:

```typescript
@Module({
  providers: [
    { provide: EMAIL_CLIENT, useClass: ResendEmailClient },            // consumer-owned
    { provide: USER_CONTACT_RESOLVER, useClass: DrizzleUserResolver }, // consumer-owned
    { provide: NOTIFICATION_TEMPLATE_REPOSITORY, useClass: DrizzleTemplateRepository }, // consumer-owned
    EmailNotificationSender,
  ],
  exports: [EmailNotificationSender],
})
export class AppNotificationModule {}
```
