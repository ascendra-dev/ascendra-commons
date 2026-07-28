# Notification Pattern

## Overview

A project must inform users of events (invoice sent, payment received, reminders
due) without embedding notification logic in feature code, and without building a
full multi-channel delivery system before it's needed. This pattern defines
notifications as a standalone, swappable module triggered by domain events, never
called inline — and lets one event type fan out to one or more channels,
configurably, without the caller ever knowing how many channels are involved.

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
  send(request: NotificationRequest): Promise<NotificationResult>;
}
```

Feature code never calls `NotificationSender` directly — it raises a domain event
(see the `domain-events` pattern), and a listener depending only on this interface
reacts to it:

```typescript
// In a listener — see domain-events' README for the full raise/listen shape
@Injectable()
export class InvoiceVoidedNotifier {
  constructor(@Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender) {}

  @OnEvent(InvoiceEvents.VOIDED)
  async onInvoiceVoided(event: InvoiceVoided) {
    const result = await this.notifications.send({
      recipient: { type: 'raw', email: event.payerEmail },
      eventType: 'invoice.voided',
      variables: { invoiceNumber: event.invoiceNumber, reason: event.reason },
    });
    if (result.status === 'failed') {
      // log it, never rethrow
    }
  }
}
```

This listener never imports `LogNotificationSender`, `EmailNotificationSender`, or
`NotificationRouter` — it only knows `NOTIFICATION_SENDER` and the interface.
Whether "the notification sender" turns out to be one channel or five is decided
entirely by what the app's own module binds that token to (see "Consuming this
module" below) — never by anything in this listener.

Call this from a listener registered via `domainEvents.emit()` (best-effort), or
have the listener itself catch its own errors if it shares an event name with a
must-not-fail listener — see the domain-events pattern's reliability-tiering
section for why that distinction matters.

### `NotificationResult` — an honest answer even when multiple channels were involved

```typescript
export interface NotificationChannelResult {
  status: 'sent' | 'failed';
  reason?: string;
}

export interface NotificationResult {
  status: 'sent' | 'partial' | 'failed';
  reason?: string;
  channels?: Partial<Record<NotificationChannel, NotificationChannelResult>>;
}
```

A single-channel sender (`LogNotificationSender`, `EmailNotificationSender`) only
ever returns `'sent'` or `'failed'`, with no `channels` breakdown — there's only
one channel, nothing to break down. `NotificationRouter` (below) is the only thing
that can return `'partial'`, always with the full per-channel detail attached, so
a caller checking only `status` gets a safe answer and a caller that wants to know
exactly which channel failed can look.

### Templates are data, not code — per channel, since channel shapes differ

A lookup table maps `eventType -> template` with `{{variable}}` placeholders
(`renderTemplate`, shipped here). Each channel owns its own template repository
and its own injection token — `EmailNotificationSender` uses
`NOTIFICATION_TEMPLATE_REPOSITORY` (`{ subject, body }`); a future WhatsApp sender
would define its own token and its own shape (no `subject` — likely a pre-approved
template name and structured params, not free-form text), rather than forcing
every channel into one artificial shared template shape.

### Which channel(s) an event type uses — also data, not code

```typescript
export interface NotificationChannelPolicy {
  channelsFor(eventType: string): Promise<NotificationChannel[]>;
}
```

Exactly the same discipline as templates, applied one level up: `{ 'invoice.sent':
['email'], 'payment.overdue.reminder': ['email', 'log'] }` is a config row, not an
`if/else` per event type. An event type with no entry resolves to zero channels —
fails closed and visibly (`NotificationRouter` reports `'no_channel_configured'`)
rather than guessing a default that might silently be wrong.

### `NotificationRouter` — implements the same interface, fans out internally

```typescript
export class NotificationRouter implements NotificationSender {
  async send(request: NotificationRequest): Promise<NotificationResult> {
    const channels = await this.policy.channelsFor(request.eventType);
    // dispatch to each channel's own sender in parallel, aggregate:
    // 'sent' only if every channel sent; 'failed' only if every channel failed;
    // 'partial' otherwise — always with the full per-channel breakdown attached.
  }
}
```

The router doesn't know how to send email or how to log anything — it only knows
how to ask the policy which channels apply, and delegate to whichever
`NotificationSender` is registered for each one. A channel configured by the
policy but never registered in the sender map fails that one channel with
`'channel_not_registered'` rather than crashing the whole request — a realistic
misconfiguration (policy and sender map are assembled separately by the
consumer), so it degrades to a per-channel failure like any other.

## Implementations

- **`LogNotificationSender`** — records intent without sending anything. Backed by
  `NotificationLogStore`; ships with `InMemoryNotificationLogStore` (zero external
  dependency) and wired into `NotificationModule` out of the box.
- **`EmailNotificationSender`** — one real email channel. Needs three bindings
  only the consuming project can supply: `EmailClient`, `UserContactResolver`,
  `NotificationTemplateRepository`.
- **`NotificationRouter`** — not a channel itself; composes any number of the
  above (or future channels) behind the same `NotificationSender` interface.
- Future channels (SMS, WhatsApp, push) — added only when a specific story
  requires them: define the channel in `NotificationChannel`, build a
  `NotificationSender` implementation for it, register it in the consumer's
  `NOTIFICATION_CHANNEL_SENDERS` map. Nothing about `NotificationRouter` itself
  changes.

Every implementation satisfies the same interface — swapping which one(s) are
behind `NOTIFICATION_SENDER` is a binding change in the consumer's own module,
never a call-site change.

## Model 1 — Interchangeable Single Channels, Plus Configurable Multi-Channel Routing (current)

Both single-channel senders and the router are real, shipped, tested code — not
deferred. Which shape a project actually binds is project-specific: a project
needing exactly one channel binds that sender directly to `NOTIFICATION_SENDER`;
a project needing per-event-type channel selection binds `NotificationRouter`
instead, with a plain static config object (`StaticNotificationChannelPolicy`) —
no DB table, no admin UI, the same "data, not code, but not over-built either"
pacing already used for templates.

Do not build end-to-end tests against a real delivery provider until that channel
is actually load-bearing in production — unit-test each sender against a fake
`EmailClient`/`UserContactResolver`/`NotificationTemplateRepository` instead, and
unit-test `NotificationRouter` against fake `NotificationSender`s, as this
module's own `.spec.ts` files do. `notification-router.module-wiring.spec.ts`
additionally proves the whole graph — router, policy, two real leaf senders,
factory-assembled channel map — resolves correctly through an actual NestJS
container, since wiring bugs like a missing binding or a `useExisting` mismatch
only surface when a real container boots, not from typecheck alone.

## Model 2 — Additional Channels, DB-Backed Policy (future target)

- Real SMS/WhatsApp/push adapters — no concrete implementation exists yet, only
  the extension point (`NotificationChannel`, a `NotificationSender`
  implementation, a registration in the channel map). Build one only when a
  specific story needs that channel.
- A DB-backed `NotificationChannelPolicy` implementing the same interface as
  `StaticNotificationChannelPolicy`, once a project needs non-developers to
  manage channel routing without a deploy.
- Per-recipient channel *preference* (e.g. a `'user'` recipient who opted out of
  email) is a distinct, not-yet-modeled concern from per-*event-type* channel
  selection — `NotificationChannelPolicy` currently only answers "which
  channel(s) does this event type use," not "does this specific recipient want
  this channel." Revisit if a story needs it.

## Consuming this module

Copy the `notification/`, `domain-events/` folders verbatim into the consumer
project's `src/`.

**Single channel, log-only** — import `NotificationModule` as-is, no bindings needed:

```typescript
@Module({ imports: [NotificationModule] })
export class AppModule {}
```

**Single channel, real email** — bind the three consumer-owned interfaces plus
`NOTIFICATION_SENDER` directly to `EmailNotificationSender`:

```typescript
@Module({
  providers: [
    { provide: EMAIL_CLIENT, useClass: ResendEmailClient },
    { provide: USER_CONTACT_RESOLVER, useClass: DrizzleUserResolver },
    { provide: NOTIFICATION_TEMPLATE_REPOSITORY, useClass: DrizzleTemplateRepository },
    EmailNotificationSender,
    { provide: NOTIFICATION_SENDER, useExisting: EmailNotificationSender },
  ],
  exports: [NOTIFICATION_SENDER],
})
export class AppNotificationModule {}
```

**Multi-channel, configurable per event type** — assemble the leaf senders, the
policy, and the channel map, then bind `NOTIFICATION_SENDER` to the router:

```typescript
@Module({
  providers: [
    // leaf senders — each with their own bindings, exactly as above
    { provide: NOTIFICATION_LOG_STORE, useClass: InMemoryNotificationLogStore },
    LogNotificationSender,
    { provide: EMAIL_CLIENT, useClass: ResendEmailClient },
    { provide: USER_CONTACT_RESOLVER, useClass: DrizzleUserResolver },
    { provide: NOTIFICATION_TEMPLATE_REPOSITORY, useClass: DrizzleTemplateRepository },
    EmailNotificationSender,

    // which event types use which channel(s) — project-specific config
    {
      provide: NOTIFICATION_CHANNEL_CONFIG,
      useValue: {
        'invoice.sent': ['email'],
        'payment.overdue.reminder': ['email', 'log'],
      },
    },
    StaticNotificationChannelPolicy,
    { provide: NOTIFICATION_CHANNEL_POLICY, useExisting: StaticNotificationChannelPolicy },

    // which concrete sender backs each channel name
    {
      provide: NOTIFICATION_CHANNEL_SENDERS,
      useFactory: (log: LogNotificationSender, email: EmailNotificationSender) =>
        new Map([
          ['log', log],
          ['email', email],
        ]),
      inject: [LogNotificationSender, EmailNotificationSender],
    },

    NotificationRouter,
    { provide: NOTIFICATION_SENDER, useExisting: NotificationRouter },
  ],
  exports: [NOTIFICATION_SENDER],
})
export class AppNotificationModule {}
```

Whichever of these three a project chooses, `InvoiceVoidedNotifier` (and every
other listener) is identical — it only ever depends on `NOTIFICATION_SENDER` and
`NotificationSender`.
