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

- **No `applicationId` in the core `NotificationConfig` interface** — dispatch
  and rendering never need it. The **Postgres/Drizzle adapter** *does* carry an
  `application` column on every table and filters every read by it (from
  `PostgresNotificationConfigModule.forRoot({ application })`) — constant, and
  therefore free, within one app's own database, but it keeps those tables
  correct if all Ascendra apps' notification config is ever consolidated into
  one shared database (a `notificationType` both `ascendra-pay` and
  `ascendra-erp` define stays distinct). A consumer on another stack writing
  their own `NotificationConfig` scopes queries however their deployment needs.
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

**`ProviderConfig`** is `Record<string, unknown>` — an **opaque JSON object**.
This library never reads inside it: credential shapes vary by provider (a single
API key; access key + secret + region; an OAuth token; SID + auth token +
number) and can't be anticipated. The consumer's real `send()` interprets it;
the Postgres adapter stores it as one `jsonb` column. Must be JSON-serialisable.

**`StaticNotificationConfig`** is the Model 1 implementation, built from an
in-memory object:

The per-method `tenantId` treatment is a **deliberate asymmetry** — it turns on
whether per-tenant is the *normal* shape or an *eventual divergence*:

- `channelsFor` / `templateFor` **ignore** `tenantId` — one routing config and
  one template set for the whole deployment. Per-tenant routing or white-labeled
  content is an eventual divergence: when a tenant needs it, go
  `model: 'database'` (the DB-backed `NotificationConfig` resolves a
  tenant-specific row first, falling through to the deployment default — see
  "Going database-backed" below). Same Model 1/Model 2 split `authorization`
  makes for personas — its static authorizer has one persona map for the
  deployment, not per-tenant.
- `providerConfigFor` **honors** `tenantId` — "one tenant, one provider
  account" is the normal shape from day one (a tenant bringing their own
  SendGrid/Twilio account isn't a scaling exception, it's the point). A `null`
  tenantId resolves to `null` (fails closed), never a deployment-wide fallback.

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
  recipient's address, resolve that tenant's provider config
  (`config.providerConfigFor('email', …)`), look up the channel's template
  (`config.templateFor('email', …)`), render it, and (today) log the rendered
  message. The provider config is *not* logged — it's an opaque blob that may
  hold secrets. Fails in this order — cheapest check first:
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
        // opaque per-provider blob — your send() reads it, this library doesn't
        email: { 'tenant-a': { apiKey: 'sg-...', from: 'billing@tenant-a.com' } },
        sms:   { 'tenant-a': { accountSid: 'AC...', authToken: 'tw-...', from: '+15551234567' } },
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

On the common Postgres/Drizzle stack, **use the shipped adapter** —
`notification/adapters/postgres-drizzle/`. It's one `NotificationConfig`
implementation over three tables (`commons_notification_channel_route`,
`commons_notification_template`, `commons_notification_provider_credential`), a TTL cache, a
migration, and a seed helper. See that folder's README; the wiring is:

```typescript
import {
  PostgresNotificationConfigModule,
  POSTGRES_NOTIFICATION_CONFIG,
} from './ascendra-commons/notification/adapters/postgres-drizzle';

NotificationModule.forRoot({
  model: 'database',
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  imports: [
    PostgresNotificationConfigModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      application: 'ascendra-pay',
      imports: [DatabaseModule],
    }),
  ],
});
```

`channelsFor` / `templateFor` resolve a tenant-specific row first, falling
through to the `tenant_id IS NULL` deployment default. `providerConfigFor` does
**not** fall through — a missing row is `'no_provider_config'`, never another
tenant's account.

On another stack, write your own class `implements NotificationConfig` and
bind it under your own token — same `forRoot` shape.

### Going database-backed for one method only

If your need is only per-tenant *routing and templates* — not credentials —
`extends StaticNotificationConfig`, override those methods to hit the DB, and
leave `providerConfigFor` reading the static `providerConfigs` passed to
`super()`. No secrets in the routing DB.

```typescript
class DbRoutingConfig extends StaticNotificationConfig {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {
    super({ channels: {}, templates: {}, providerConfigs: { email: { 'tenant-a': { apiKey: '...', from: '...' } } } });
  }
  async channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    const rows = await this.db.select().from(channelRouteTable)
      .where(and(eq(channelRouteTable.notificationType, notificationType),
                 or(eq(channelRouteTable.tenantId, tenantId), isNull(channelRouteTable.tenantId))))
      .orderBy(sql`tenant_id is null`).limit(1);
    return rows[0]?.channels ?? [];
  }
}
```

Bind it under `model: 'database'` + `configToken`.

### Why `configToken` has to be a `forRoot()` option

`Notifier` and the senders are constructed inside `NotificationModule`'s own DI
scope, and NestJS provider registries are per-module — a
`{ provide: NOTIFICATION_CONFIG, useClass: … }` declared in a separate module
does **not** reach them. Passing your token through `forRoot()` (which then
binds it in the right scope) is the actual seam. (`@nestjs/testing`'s
`.overrideProvider()` can reach across scopes, but that's test-only.)

## What's not built yet

- **No real `WhatsappNotificationSender`** — needs its own template shape first.
- **No real email/SMS/WhatsApp delivery** — every sender resolves real
  per-tenant credentials now but still only logs the rendered message. Swapping
  in a real provider call means changing what a sender's `send()` does with the
  `ProviderConfig` it already has — nothing about `Notifier`, `NotificationConfig`,
  or the templates.
