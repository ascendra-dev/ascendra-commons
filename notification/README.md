# Notification Pattern

> Structure-only pass — no tests yet. This README describes the shape so it can
> be reviewed before tests and further wiring examples are added.

## Overview

A project must inform users of events (invoice sent, payment received, reminders
due) without embedding notification logic in feature code. One event type can
fan out to one or more channels (email, WhatsApp, SMS), configurably — and a
channel's *identity* is fixed by business intent from day one, independent of
whether that channel's actual delivery mechanism exists yet. Today, every
channel can be a log statement; swapping one channel to real delivery later is
one binding change, never a change to routing, templates, or feature code.

## The pieces, in dependency order

### `Notifier` — the one interface everything implements

```typescript
export interface Notifier {
  notify(request: NotificationRequest): Promise<NotificationResult>;
}
```

A single channel and a router fanning out to several both satisfy this exact
interface — a caller of `notify()` cannot tell which it's talking to. Feature
code never calls this directly — it raises a domain event, and a listener
depending only on this interface reacts to it (see the `domain-events` pattern).

### `ChannelAddressResolver` — how a channel gets its own address out of a recipient

```typescript
export interface ChannelAddressResolver {
  resolve(recipient: NotificationRecipient): Promise<string | null>;
}
```

One implementation per *address type*, not per channel: `EmailAddressResolver`
reads `.email`, `PhoneAddressResolver` reads `.phone` — WhatsApp and SMS share
`PhoneAddressResolver`, since both address by phone number. Both read from the
same consumer-supplied `UserContactResolver` for `'user'` recipients.

### `ChannelTransport` — the one thing that's actually a stub today

```typescript
export interface ChannelTransport {
  deliver(params: { to: string; message: RenderedMessage }): Promise<void>;
}
```

`LogChannelTransport` records the rendered message without delivering it — any
channel can be bound to this today. `EmailChannelTransport` is the one real
transport built so far, shown as the worked example of what "swap this one
binding" looks like once a channel goes from stub to real.

### `NotificationTemplateRepository` / `renderTemplate` — unchanged, reused per channel

Each channel gets its **own token** (`EMAIL_TEMPLATE_REPOSITORY`,
`WHATSAPP_TEMPLATE_REPOSITORY`, `SMS_TEMPLATE_REPOSITORY`) even though they
currently share the same `{ subject, body }` shape — "each channel maintains its
own set of templates" is about storage/ownership, not necessarily a different
TypeScript shape. **Known limitation, flagged deliberately:** a real WhatsApp
provider (e.g. Meta's Business API) typically requires pre-approved template
names with structured params, not free-form `{{variable}}` text — the shared
shape will likely need to split apart once a real WhatsApp provider is chosen.
Not a reason to avoid the shared shape today; just don't be surprised later.

### `ChannelNotifier` — composes the three pieces above into one `Notifier`

```typescript
export class ChannelNotifier implements Notifier {
  constructor(
    private readonly addressResolver: ChannelAddressResolver,
    private readonly templates: NotificationTemplateRepository,
    private readonly transport: ChannelTransport,
  ) {}

  async notify(request: NotificationRequest): Promise<NotificationResult> {
    const address = await this.addressResolver.resolve(request.recipient);
    if (!address) return { status: 'failed', reason: 'no_address_available' };

    const template = await this.templates.findByEventType(request.eventType);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    // ...deliver via transport, never throws — see the actual file for the full body
  }
}
```

Email, WhatsApp, and SMS are all just *different configurations* of this one
class — not three separate implementations. Resolve address → look up own
template → render → deliver is real for every channel from the start; only
`deliver()`'s actual behavior (log vs. real) differs per configuration.

Not `@Injectable()` with token-based constructor params, because three
differently-configured instances of the same class can't come from one fixed
provider registration — each channel's instance is built via a `useFactory` in
the consumer's own module (worked example below).

### `NotifierChannelPolicy` — which channel(s) an event type uses, as data

```typescript
export interface NotifierChannelPolicy {
  channelsFor(eventType: string): Promise<NotificationChannel[]>;
}
```

`{ 'invoice.sent': ['email'], 'payment.overdue.reminder': ['email', 'whatsapp'] }`
is a config row, not an `if/else` per event type — the business decision "what
channels does this event use," independent of whether each channel's transport
is a stub or real. `StaticNotifierChannelPolicy` is the Model 1 implementation;
a DB-backed one is a future target, same interface. An event type with no entry
resolves to zero channels — fails closed and visibly, rather than guessing.

### `NotifierRouter` — implements `Notifier`, fans out internally

Asks the policy which channels apply, dispatches to each channel's own
`Notifier` in parallel, aggregates: `'sent'` only if every channel sent,
`'failed'` only if every channel failed, `'partial'` otherwise — always with
the full per-channel breakdown attached.

## Assembling three channels, all currently stubbed as logs

This is the shape a consumer's own module would wire — not yet written up as a
full worked example in this pass, since the point right now is reviewing the
structure itself. In outline: bind `USER_CONTACT_RESOLVER` and
`NOTIFICATION_LOG_STORE` once; construct three `ChannelNotifier` instances via
`useFactory` (email using `EmailAddressResolver` + `EMAIL_TEMPLATE_REPOSITORY` +
`LogChannelTransport`, whatsapp using `PhoneAddressResolver` +
`WHATSAPP_TEMPLATE_REPOSITORY` + `LogChannelTransport`, sms likewise); assemble
`NOTIFIER_CHANNELS` as a `Map` from those three; bind `NOTIFIER_CHANNEL_CONFIG`
to the real per-event-type channel list; bind `NOTIFIER` to `NotifierRouter`.
Going from "whatsapp is a log" to "whatsapp is real" later is exactly one
change: swap `LogChannelTransport` for a real WhatsApp transport in the
whatsapp `ChannelNotifier`'s factory — nothing else in this list moves.

## What's deliberately not here yet

- No `.spec.ts` files — structure first, tests next pass.
- No shipped default module (no `notification.module.ts`) — assembling channels
  is inherently a consumer decision now, not something to default.
- No real WhatsApp/SMS transport — `LogChannelTransport` stands in for both.
- No consuming/wiring code example fully written out — see the outline above;
  full worked examples return once this shape is confirmed.
