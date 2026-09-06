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

Built and audited against `MODULE-STANDARD.md` (this repo's root).

- **No `applicationId`** anywhere in this module's interfaces — deliberately
  N/A. Every table a database-backed implementation queries belongs to one
  app's own database, so there's nothing to disambiguate at read time, and a
  notification never lands anywhere a second Ascendra application also publishes
  to (no broker, no shared sink). If you want an app-id value on a
  database-backed schema for future cross-app reporting, stamp it as a **passive
  column** written on insert, never a query parameter — declare your own token
  in your own module and inject it there (see `MODULE-STANDARD.md` dimension 4).
- **`tenantId`** *is* threaded as a real parameter, on `NotificationRequest` and
  every method of `NotificationConfig`. `StaticNotificationConfig` honors it for
  `providerConfigFor` and ignores it for `channelsFor`/`templateFor` — see
  below.

## The pieces

### `Notifier` — the one thing feature/listener code depends on

```typescript
constructor(@Inject(NOTIFIER) private readonly notifier: Notifier) {}
...
const result = await this.notifier.notify({ recipient, notificationType, variables, tenantId });
```

A concrete class, not an interface — exactly one implementation with real
behavior worth having directly.

- **`notify(request)`** — never throws, not even if `NotificationConfig` itself
  throws (a database-backed one can). Retrieves the channels for
  `request.notificationType`, dispatches to each channel's `NotificationSender`
  in parallel, aggregates: `'sent'` only if every channel sent, `'failed'` only
  if every channel failed, `'partial'` otherwise — always with the full
  per-channel breakdown in `channels`.
- **`notifyCritical(request, strict = false)`** — the `emitCritical()`
  counterpart. `strict = false`: throws only if *every* channel failed.
  `strict = true`: throws if *any* channel failed. The thrown
  `NotificationDeliveryError` carries the full `NotificationResult`.

### `NotificationConfig` — the one configuration surface

```typescript
export interface NotificationConfig {
  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]>;
  templateFor(channel: NotificationChannel, notificationType: string, tenantId: string | null): Promise<NotificationTemplate | null>;
  providerConfigFor(channel: NotificationChannel, tenantId: string | null): Promise<ProviderConfig | null>;
}
```

One interface, one token (`NOTIFICATION_CONFIG`) — channel routing, per-channel
templates, per-channel delivery credentials. `channelsFor` returns which
channels a type uses; `templateFor`/`providerConfigFor` take the channel as a
parameter (the calling sender always knows its own).

**`ProviderConfig`** is `{ apiKey, from, fromName? }` — `from` is the sender
identity (an address for email, a number/sender id for SMS/WhatsApp). Field
names are provider-agnostic (not SendGrid's/Twilio's/Meta's shape); a
consumer's real delivery call maps them onto whichever provider they pick.

**`StaticNotificationConfig`** is the Model 1 implementation, built from an
in-memory object:

- `channelsFor` / `templateFor` **ignore** `tenantId` — one config for the
  whole deployment. A tenant needing different routing or white-labeled content
  is the signal to supply a full `NotificationConfig` via `configToken`, not to
  add tenant branching here (the same Model 1/Model 2 split `authorization`
  makes for personas).
- `providerConfigFor` **honors** `tenantId` — "one tenant, one provider
  account" is the normal shape from day one (a tenant bringing their own
  SendGrid/Twilio account isn't a scaling exception). A `null` tenantId
  resolves to `null` (fails closed), never a deployment-wide fallback.

An unconfigured `notificationType` resolves to zero channels — `Notifier`
reports `'no_channel_configured'`. A missing template or missing credentials is
a graceful per-send failure (`'template_not_found'` / `'no_provider_config'`),
not a wiring error.

### `NotificationTemplate` / `renderTemplate`

`{ subject?, body, isHtml? }` — `subject`/`isHtml` are email-only; SMS leaves
them unset. `renderTemplate()` does `{{variable}}` substitution and leaves a
missing variable as a **visible placeholder** rather than silently blanking it
— a blank body reads as "working," a visible `{{placeholder}}` gets noticed.

WhatsApp does not use this shape — its templates are pre-approved and named on
Meta's side with positional numbered parameters. That's a distinct shape for a
later piece.

### `NotificationSender` — one implementation per channel

An interface — Email/WhatsApp/SMS share no behavior. Each sender injects
`NOTIFICATION_CONFIG` and (email/SMS) `USER_CONTACT_RESOLVER`.

- **`EmailNotificationSender`** / **`SMSNotificationSender`** — resolve the
  recipient's address, resolve that tenant's credentials
  (`config.providerConfigFor('email', …)`), look up the channel's template
  (`config.templateFor('email', …)`), render it, and (today) log the rendered
  result with the `from` identity. Fails in this order — cheapest check first:
  `'no_address_available'` → `'no_provider_config'` → `'template_not_found'`.
- **`WhatsappNotificationSender`** — a stub for templates/delivery,
  deliberately (see `NotificationTemplate` above). It does resolve provider
  config, the same as the other two.

### `UserContactResolver` — resolving a `'user'` recipient's address

```typescript
export interface UserContactResolver {
  findById(id: string): Promise<{ email?: string; phone?: string } | null>;
}
```

Kept **separate** from `NotificationConfig` — it's a different axis: "who am I
sending to" (resolved per recipient, against the consumer's user table), not
"how is this notification configured." One resolver, shared by email and SMS —
each reads the field it needs. A `'raw'` recipient never calls it.

`NotificationModule.forRoot()` binds `NullUserContactResolver` by default
(every `'user'` recipient → "no match" → a clean `'no_address_available'`), so
`forRoot()` works out of the box for a project that only uses `'raw'`
recipients. A consumer with a real user table overrides via
`userContactResolverToken`.

## Consuming this module

Copy `notification/` and `domain-events/` into `src/ascendra-commons/`, then:

```typescript
@Module({
  imports: [
    NotificationModule.forRoot({
      channels: {
        'invoice.sent': ['email'],
        'payment.confirmed': ['email', 'sms'],
      },
      templates: {
        email: {
          'invoice.sent': { subject: 'Invoice {{invoiceNumber}} is ready', body: '...' },
          'payment.confirmed': { subject: 'Payment received', body: '...' },
        },
        sms: {
          'payment.confirmed': { body: 'Payment of {{amount}} received' },
        },
      },
      providerConfigs: {
        email: { 'tenant-a': { apiKey: 'sg-...', from: 'billing@tenant-a.com' } },
        sms:   { 'tenant-a': { apiKey: 'tw-...', from: '+15551234567' } },
      },
    }),
  ],
})
export class AppModule {}
```

`model` defaults to `'static'` (shown above) — `channels` required, `templates`
and `providerConfigs` optional (a missing entry is a graceful per-send
failure). `model: 'database'` binds your own `NotificationConfig` via
`configToken` instead — the same `model`-selects-the-implementation shape
`authorization`'s `model` and `domain-events`' `transport` use.
`forRoot()` wires `NullUserContactResolver`, the config, all three senders, the
`NOTIFICATION_CHANNEL_SENDERS` map, and `Notifier` — exporting only `NOTIFIER`.

### Going database-backed

One class implementing three methods, against one schema area (three small
generic tables, or one). Provide it under your own token, pass that token to
`forRoot()`:

```typescript
// In the consuming project:
class DatabaseNotificationConfig implements NotificationConfig {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {}

  async channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    // tenant-specific row first, falling through to the tenant-less deployment default (tenant_id IS NULL)
    const rows = await this.db.select().from(channelRoutingTable)
      .where(and(
        eq(channelRoutingTable.notificationType, notificationType),
        tenantId ? inArray(channelRoutingTable.tenantId, [tenantId, null]) : isNull(channelRoutingTable.tenantId),
      ))
      .orderBy(desc(channelRoutingTable.tenantId));
    return rows[0]?.channels ?? [];
  }

  async templateFor(channel, notificationType, tenantId) { /* same fall-through shape, WHERE channel = $1 */ }

  async providerConfigFor(channel, tenantId) {
    if (tenantId === null) return null; // credentials never fall through to a default — a missing row is a config error
    const rows = await this.db.select().from(providerCredentialTable)
      .where(and(eq(providerCredentialTable.channel, channel), eq(providerCredentialTable.tenantId, tenantId)));
    return rows[0] ?? null;
  }
}
```

```typescript
@Module({
  providers: [{ provide: DATABASE_NOTIFICATION_CONFIG, useClass: DatabaseNotificationConfig }],
  exports: [DATABASE_NOTIFICATION_CONFIG],
})
export class MyNotificationConfigModule {}

NotificationModule.forRoot({
  model: 'database',
  configToken: DATABASE_NOTIFICATION_CONFIG,
  imports: [MyNotificationConfigModule],
});
```

Notes:

- Use the core query builder (`db.select().from(table)`), not the relational API
  (`db.query.…`) — the latter forces this class to know the consuming project's
  full schema; the core builder works against any table object.
- **`channelsFor`/`templateFor` fall through** a tenant-specific row to the
  `tenant_id IS NULL` deployment default. **`providerConfigFor` does not** — "no
  credentials for this tenant" is a configuration error worth surfacing as
  `'no_provider_config'`, not a silent fallback to another tenant's account.
- Stamp `application_id` on the tables (written on insert, never queried) if you
  ever want cross-app reporting — see the Overview.

### Going database-backed for one method only

`extends StaticNotificationConfig` and override that one method; the others keep
serving the static data passed to `super()`:

```typescript
class DbRoutingConfig extends StaticNotificationConfig {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {
    super({ channels: {}, templates: { email: { /* ... */ } }, providerConfigs: { /* ... */ } });
  }
  async channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    return this.db.channelsFor(notificationType, tenantId);
  }
}
```

Bind it under a token and pass `model: 'database'` + `configToken` exactly as
above. This is *less* work than the old per-piece override grid — templates and
credentials stay static with no extra wiring.

### Why `configToken` has to be a `forRoot()` option

`Notifier` and the senders are constructed inside `NotificationModule`'s own DI
scope, and NestJS provider registries are per-module — a
`{ provide: NOTIFICATION_CONFIG, useClass: … }` declared in a separate module
does **not** reach them. Passing your token through `forRoot()` (which then
binds it in the right scope) is the actual seam. (`@nestjs/testing`'s
`.overrideProvider()` can reach across scopes, but that's test-only.)

## What's not built yet

- **No real `WhatsappNotificationSender`** — needs its own template shape first.
- **No database-backed `NotificationConfig` shipped here** — the pattern is
  documented above; the class belongs in each consuming project.
- **No real email/SMS/WhatsApp delivery** — every sender resolves real
  per-tenant credentials now but still only logs the rendered message. Swapping
  in a real provider call means changing what a sender's `send()` does with the
  `ProviderConfig` it already has — nothing about `Notifier`, `NotificationConfig`,
  or the templates.
