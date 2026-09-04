# Notification Pattern

## Overview

A project must inform users of events (invoice sent, payment received, reminders
due) without embedding notification logic in feature code. One notification type
can fan out to one or more channels (email, WhatsApp, SMS), configurably — and a
channel's *identity* is fixed by business intent from day one, independent of
whether that channel's real delivery mechanism exists yet. Email and SMS have
real (template-rendering) implementations today; WhatsApp is still a stub, since
its real templates work fundamentally differently (see below). Swapping a stub
for real delivery later is one binding change, never a change to routing,
templates, or feature code.

Built and audited against `MODULE-STANDARD.md` (this repo's root). Two
dimensions worth stating explicitly: no `applicationId` anywhere in this
module — deliberately N/A, since a notification never lands anywhere a second
Ascendra application also publishes to (no broker, no shared sink); `tenantId`
*is* threaded, on `NotificationRequest` and both `NotificationChannelConfig`/
`NotificationTemplateRepository` — see "`NotificationChannelConfig`" below.

## The pieces

### `Notifier` — the one thing feature/listener code depends on

```typescript
constructor(@Inject(NOTIFIER) private readonly notifier: Notifier) {}
...
const result = await this.notifier.notify({ recipient, notificationType, variables });
```

A concrete class, not an interface — there is exactly one implementation, with
real behavior worth having directly (unlike the pieces below, which have
genuinely different implementations that share no behavior with each other).

- **`notify(request)`** — never throws, not even if `NotificationChannelConfig`
  itself throws (a database-backed one, once one exists, genuinely can). Retrieves
  the configured channels for `request.notificationType`, dispatches to each
  channel's own `NotificationSender` in parallel, and aggregates: `'sent'` only
  if every channel sent, `'failed'` only if every channel failed, `'partial'`
  otherwise — always with the full per-channel breakdown in `channels`.
- **`notifyCritical(request, strict = false)`** — the `emitCritical()` counterpart
  from `domain-events`, reusing `notify()` rather than duplicating dispatch logic.
  `strict = false`: throws only if *every* channel failed. `strict = true`: throws
  if *any* channel failed. Either way, the thrown `NotificationDeliveryError`
  carries the full `NotificationResult` so a caller that catches it can still see
  per-channel detail.

### `NotificationChannelConfig` — which channel(s) a notificationType uses

An interface: static (here) and database-backed (in a consuming project) share no
behavior, so a shared base class would be ceremony with no payoff. `{
'invoice.sent': ['email'], 'payment.confirmed': ['email', 'sms'] }` is a config
row, not an `if/else` per notification type — the business decision "what
channels does this use," independent of whether each channel's transport is a
stub or real. An unconfigured `notificationType` resolves to zero channels —
fails closed and visibly (`Notifier` reports `'no_channel_configured'`).

`StaticNotificationChannelConfig` is the Model 1 implementation, and belongs in
this shared library because it's genuinely generic — it has no knowledge of any
specific project's schema. A database-backed implementation lives in the
*consuming* project instead (see "Going to a database-backed channel config"
below) — this library can't know `ascendra-pay`'s schema versus
`ascendra-school-erp`'s, but a database-backed implementation can still be built
using a schema this library exports, since the channel-config table itself is
generic enough to be shared.

**`channelsFor(notificationType, tenantId)`** always takes `tenantId` (`request.tenantId ?? null`,
mirroring `Actor.tenantId` in `authorization`) — `StaticNotificationChannelConfig`
receives it and ignores it, since Model 1 is one config for the whole
deployment by design. This is the same Model 1/Model 2 split `authorization`
makes for personas: a tenant needing different channel routing than every
other tenant is the concrete signal to build a database-backed
`NotificationChannelConfig`, not to add tenant branching into the static map.
`NotificationTemplateRepository.templateFor()` carries the same parameter, for
the same reason (a white-labeled tenant's own template content).

### `NotificationTemplateRepository` — which text a notificationType uses, per channel

Also an interface, same reasoning. Each channel gets **its own instance** —
`EMAIL_TEMPLATE_REPOSITORY` and `SMS_TEMPLATE_REPOSITORY` are separate tokens,
even though both are backed by the same `StaticNotificationTemplateRepository`
class, since each channel maintains its own templates. `subject`/`isHtml` are
email-only fields on `NotificationTemplate` — SMS templates just leave them
unset, since SMS has no subject line and no HTML concept.

`renderTemplate()` does `{{variable}}` substitution. A missing variable is left
as a visible, unresolved placeholder rather than silently blanked — a blank
subject/body reads as "working," a visible placeholder is obviously wrong and
gets noticed before it reaches a user.

### `NotificationSender` — one implementation per channel

An interface — Email/WhatsApp/SMS share no behavior with each other, so there's
no shared base worth having.

- **`EmailNotificationSender`** / **`SMSNotificationSender`** — real: resolve the
  recipient's address (see `UserContactResolver` below), look up their own
  template, render it, and (today) log the rendered result. Fail with
  `'no_address_available'` if the recipient has no address for that channel, or
  `'template_not_found'` if no template is registered for the notificationType —
  address resolved first, since there's no point rendering a template for nobody.
- **`WhatsappNotificationSender`** — still a stub, deliberately. WhatsApp's real
  templates are pre-approved and *named* on Meta's side, with **positional
  numbered parameters** (`{{1}}`, `{{2}}`, ...), not free-form `{{variable}}` text
  this library renders — a fundamentally different shape from
  `NotificationTemplate`. Building a real `WhatsappNotificationSender` means
  designing that shape first, not forcing WhatsApp into the email/SMS shape.

### `UserContactResolver` — resolving a `'user'` recipient's address

```typescript
export interface UserContactResolver {
  findById(id: string): Promise<{ email?: string; phone?: string } | null>;
}
```

One resolver, shared by both `EmailNotificationSender` and `SMSNotificationSender`
— each just reads the field it needs (email vs. phone) from the same lookup,
since "resolve this user's contact info" is one concern, not two. A `'raw'`
recipient never calls this at all — its email/phone is already on the request.

`NotificationModule.forRoot()` binds this to `NullUserContactResolver` by
default (every `'user'` recipient resolves to "no match," which each sender
already turns into a clean `'no_address_available'` failure) — this keeps
`forRoot()` usable out of the box for a project that only ever uses `'raw'`
recipients. A consumer with a real user/issuer/staff table overrides the binding
in their own module:

```typescript
{ provide: USER_CONTACT_RESOLVER, useClass: DrizzleUserContactResolver }
```

## What "backstop" means here, and why it matters

`Notifier`'s dispatch wraps every `sender.send()` call in a `try/catch` — a
channel implementation that throws instead of catching its own error degrades to
a `{ status: 'failed', reason: <message> }` result for that one channel, rather
than crashing the entire `notify()` call. Same lesson as `domain-events`' `emit()`.

## Consuming this module

Copy `notification/` and `domain-events/` into the consumer's
`src/ascendra-commons/` (see `module-packaging-pattern.md` for why vendored
patterns land under one wrapper folder), then:

```typescript
@Module({
  imports: [
    NotificationModule.forRoot({
      channels: {
        'invoice.sent': ['email'],
        'payment.confirmed': ['email', 'sms'],
      },
      emailTemplates: {
        'invoice.sent': { subject: 'Invoice {{invoiceNumber}} is ready', body: '...' },
        'payment.confirmed': { subject: 'Payment received', body: '...' },
      },
      smsTemplates: {
        'payment.confirmed': { body: 'Payment of {{amount}} received' },
      },
    }),
  ],
})
export class AppModule {}
```

`NotificationModule.forRoot()` is a dynamic module (as is
`DomainEventsModule.forRoot()`) — but unlike `domain-events` (whose only
required-by-default field is `transport`, and that defaults to `'in-process'`,
so `forRoot()` there needs no argument), this one *always* requires config:
there's no sensible default channel/template mapping, a consumer always has
real business decisions to supply. It wires: `NullUserContactResolver`, both
static config/template implementations,
all three channel senders, the `NOTIFICATION_CHANNEL_SENDERS` map (assembled via
`useFactory`, since a `Map` isn't a class Nest can construct directly), and
`Notifier` — exporting only `NOTIFIER`, the token any listener actually injects.

**Known limitation:** `forRoot()` is all-or-nothing — there's no option to swap
in just one custom piece (e.g. `DatabaseNotificationChannelConfig`) while keeping
the rest of `forRoot()`'s wiring. A consumer wanting any customization beyond the
plain data values (`channels`, `emailTemplates`, `smsTemplates`) has to write
their own module from scratch, reusing the exported classes and tokens directly
— see "Going to a database-backed channel config" below for exactly that shape.
Adding partial-override support to `forRoot()` itself would be real
infrastructure with no confirmed need driving its exact shape yet; the
escape hatch below is deliberately the answer until one exists.

### Going to a database-backed channel config

```typescript
// In the consuming project, not in this library:
class DatabaseNotificationChannelConfig implements NotificationChannelConfig {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {}

  async channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    // Tenant-specific row first (a tenant that overrides the deployment default),
    // falling back to the tenant-less row (tenantId IS NULL) — the deployment default.
    const rows = await this.db.select().from(notificationChannelConfigTable)
      .where(and(
        eq(notificationChannelConfigTable.notificationType, notificationType),
        tenantId
          ? inArray(notificationChannelConfigTable.tenantId, [tenantId, null])
          : isNull(notificationChannelConfigTable.tenantId),
      ))
      .orderBy(desc(notificationChannelConfigTable.tenantId)); // non-null (tenant-specific) row first
    return rows[0]?.channels ?? [];
  }
}
```

This is exactly the shape `tenantId` on the interface exists for: a tenant with
no override row falls through to the deployment default (`tenantId IS NULL`)
transparently — `StaticNotificationChannelConfig` and this database-backed one
answer identically for every tenant that hasn't been given a specific row.

Use the core/raw query builder (`db.select().from(table)`), not the relational
query API (`db.query.table.findFirst()`) — the latter requires the `db` client's
own type to be parameterized with this specific table's schema, which would force
this class to know about the consuming project's full schema. The core builder
works against any table object regardless of the client's own schema generic, so
`DatabaseNotificationChannelConfig` never needs to know anything about
`ascendra-pay`'s (or any other project's) other tables. Bind it in the consuming
project's own module in place of `StaticNotificationChannelConfig`:

```typescript
{ provide: NOTIFICATION_CHANNEL_CONFIG, useClass: DatabaseNotificationChannelConfig }
```

This only stays clean as long as the channel-config table remains generic. The
moment a project needs to extend it (an audit column, a join against
project-specific data), that's the natural point to fork into a fully
project-owned table and implementation instead.

## What's not built yet

- No real `WhatsappNotificationSender` — needs its own template shape first (see above).
- No database-backed `NotificationChannelConfig`/`NotificationTemplateRepository`
  shipped here — the pattern for building one is documented above, but the actual
  class belongs in each consuming project once it's actually needed.
- No real email/SMS delivery — both senders log the rendered message rather than
  calling a real provider. Swapping that in means changing what each sender's
  `send()` does internally, not anything about `Notifier`, the channel config, or
  the templates.
