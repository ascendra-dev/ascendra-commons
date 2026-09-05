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
dimensions worth stating explicitly. No `applicationId` **query parameter**
anywhere in this module's interfaces — deliberately N/A there, since every
table a database-backed implementation queries belongs to one app's own
database, so there's nothing to disambiguate at read time (a notification
never lands anywhere a second Ascendra application also publishes to either —
no broker, no shared sink). It's **not** a `forRoot()` field either, and not
an exported token from this library at all — unlike `domain-events`'
`DOMAIN_EVENTS_APPLICATION_ID`, this one can't be delivered that way: a database-backed
override you write later is constructed in *your own* module, one `forRoot()`
merely imports *from* (`channelConfigToken`/`imports`), not a module
`forRoot()` exports into — NestJS provider registries are per-module, and
that's the wrong import direction for `forRoot()` to hand anything across, or
for an exported token to mean anything (nothing here would ever inject it by
that name). If you want an app-id value available to a database-backed
override, declare your own token in your own module and inject it there — see
"Going to a database-backed channel config" below for the concrete shape, and
`MODULE-STANDARD.md` dimension 4 for why a passive column is a different,
cheaper case than an active query parameter in the first place. `tenantId`
*is* threaded as a real query parameter, on `NotificationRequest` and all
three of `NotificationChannelConfig`/`NotificationTemplateRepository`/
`ProviderConfigResolver` — see "`NotificationChannelConfig`" and
"`ProviderConfigResolver`" below. The last of these is the one piece whose
Model 1 implementation actually branches on it, rather than ignoring it.

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

- **`EmailNotificationSender`** / **`SMSNotificationSender`** — resolve the
  recipient's address (see `UserContactResolver` below), resolve that tenant's
  delivery-provider credentials (see `ProviderConfigResolver` below), look up
  their own template, render it, and (today) log the rendered result together
  with which provider identity (`fromAddress`/`fromNumber`) it would have sent
  from. Fails, in this order: `'no_address_available'` (no address for that
  channel), `'no_provider_config'` (no credentials registered for the
  request's tenantId), `'template_not_found'` (no template for the
  notificationType) — cheapest, most-likely-to-short-circuit check first, so a
  request nobody could ever deliver never pays for a credentials lookup or a
  template render.
- **`WhatsappNotificationSender`** — still a stub for templates/delivery,
  deliberately. WhatsApp's real templates are pre-approved and *named* on
  Meta's side, with **positional numbered parameters** (`{{1}}`, `{{2}}`, ...),
  not free-form `{{variable}}` text this library renders — a fundamentally
  different shape from `NotificationTemplate`. Building a real
  `WhatsappNotificationSender` means designing that shape first, not forcing
  WhatsApp into the email/SMS shape. It does already resolve provider config,
  the same as the other two senders — that seam doesn't depend on the template
  shape being settled first.

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

### `ProviderConfigResolver<TConfig>` — per-tenant delivery-provider credentials

```typescript
export interface EmailProviderConfig {
  apiKey: string;
  fromAddress: string;
  fromName?: string;
}
export interface SmsProviderConfig { apiKey: string; fromNumber: string; }
export interface WhatsappProviderConfig { apiKey: string; fromNumber: string; }

export interface ProviderConfigResolver<TConfig> {
  configFor(tenantId: string | null): Promise<TConfig | null>;
}
```

One generic interface, reused across all three channels via `TConfig` — same
reasoning `NotificationTemplateRepository` already uses for being one shape
shared by `EMAIL_TEMPLATE_REPOSITORY`/`SMS_TEMPLATE_REPOSITORY`, rather than
three near-identical interfaces. Field names are deliberately
provider-agnostic (not SendGrid's, Twilio's, or Meta's own shape) — this
library ships the seam, never a vendor SDK call; a consumer's real delivery
implementation maps these onto whichever provider they pick.

**This is the one piece where the Model 1 implementation genuinely branches on
`tenantId`, unlike `NotificationChannelConfig`/`NotificationTemplateRepository`.**
`StaticNotificationChannelConfig` and `StaticNotificationTemplateRepository`
both *ignore* `tenantId` on purpose — Model 1 there is one deployment-wide
config until a specific tenant needs to differ, and that's the signal to go
database-backed (see "Going to a database-backed channel config" above).
Provider credentials are the opposite case: "one tenant, one provider account"
is the normal shape from day one — a payer-facing SaaS tenant bringing their
own SendGrid/Twilio account isn't a scaling exception, it's the point. So
`StaticProviderConfigResolver` — the Model 1 implementation shipped here —
looks the config up **by** `tenantId`:

```typescript
export class StaticProviderConfigResolver<TConfig> implements ProviderConfigResolver<TConfig> {
  constructor(private readonly configs: Record<string, TConfig>) {}

  async configFor(tenantId: string | null): Promise<TConfig | null> {
    if (tenantId === null) return null;
    return this.configs[tenantId] ?? null;
  }
}
```

A `tenantId` of `null` (a platform-wide notification with no single tenant)
has no credentials to look up and resolves to `null` — fails closed and
visibly, the same as every other unconfigured lookup in this module, not a
deployment-wide fallback. If a real deployment-wide default is ever needed,
that's a reason to build a database-backed `ProviderConfigResolver` with its
own fall-through-to-default query (the same tenant-row-first,
tenant-less-row-second shape `DatabaseNotificationChannelConfig` already
shows) — not to change what the static, in-memory Model 1 does.

Each channel gets its **own** token/instance — `EMAIL_PROVIDER_CONFIG`,
`SMS_PROVIDER_CONFIG`, and `WHATSAPP_PROVIDER_CONFIG` are separate, even
though all three can be backed by the same `StaticProviderConfigResolver`
class — a tenant's email provider and SMS provider are independent accounts,
not one shared credential.

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
      emailProviderConfigs: {
        'tenant-a': { apiKey: 'sg-...', fromAddress: 'billing@tenant-a.com' },
      },
      smsProviderConfigs: {
        'tenant-a': { apiKey: 'tw-...', fromNumber: '+15551234567' },
      },
      whatsappProviderConfigs: {
        'tenant-a': { apiKey: 'wa-...', fromNumber: '+15551234568' },
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
there's no sensible default channel/template/provider-credential mapping, a
consumer always has real business decisions to supply. It wires:
`NullUserContactResolver`, the static config/template/provider-config
implementations, all three channel senders, the `NOTIFICATION_CHANNEL_SENDERS`
map (assembled via `useFactory`, since a `Map` isn't a class Nest can
construct directly), and `Notifier` — exporting only `NOTIFIER`, the token any
listener actually injects.

### Swapping one piece for a database-backed implementation

Seven independently swappable pieces, not one unified Model 1/Model 2 knob —
unlike `authorization`'s `model` or `domain-events`' `transport`, which each
choose between exactly one complete implementation. A real deployment is far
more likely to want *one* piece database-backed (channel routing, say, or just
one channel's provider credentials) while the others stay static than to swap
all seven atomically, so `forRoot()` accepts seven independent override tokens
instead of one enum:

```typescript
NotificationModule.forRoot({
  channelConfigToken: DATABASE_CHANNEL_CONFIG,            // omit to use StaticNotificationChannelConfig, reading `channels`
  emailTemplateRepositoryToken: DATABASE_EMAIL_TEMPLATES, // omit to use StaticNotificationTemplateRepository, reading `emailTemplates`
  smsTemplateRepositoryToken: DATABASE_SMS_TEMPLATES,     // omit to use StaticNotificationTemplateRepository, reading `smsTemplates`
  emailProviderConfigToken: DATABASE_EMAIL_PROVIDER_CONFIG, // omit to use StaticProviderConfigResolver, reading `emailProviderConfigs`
  smsProviderConfigToken: DATABASE_SMS_PROVIDER_CONFIG,     // omit to use StaticProviderConfigResolver, reading `smsProviderConfigs`
  whatsappProviderConfigToken: DATABASE_WHATSAPP_PROVIDER_CONFIG, // omit to use StaticProviderConfigResolver, reading `whatsappProviderConfigs`
  userContactResolverToken: DRIZZLE_USER_RESOLVER,        // omit to use NullUserContactResolver
  imports: [MyNotificationProvidersModule],               // whatever module exports the token(s) above
})
```

Omit a token and `forRoot()` reads the corresponding data field, exactly as
before; supply it and `forRoot()` binds your class instead, without requiring
(or constructing anything from) that data field at all — mix and match freely,
per piece.

**Why this has to be a `forRoot()` option, not just "bind the token yourself in
your own module":** `Notifier` is constructed *inside* `NotificationModule`'s
own DI scope, and NestJS's provider registries are per-module — a
`{ provide: NOTIFICATION_CHANNEL_CONFIG, useClass: DatabaseNotificationChannelConfig }`
declared in a separate, unrelated module does **not** reach the `Notifier`
instance `forRoot()` already built; it's a different registration in a
different scope that `Notifier`'s own dependency resolution never sees. (The
one thing that *can* reach across scopes like that is `@nestjs/testing`'s
`.overrideProvider()` — a test-only capability, not something a real
`AppModule` can do.) The token fields above are the actual seam; passing your
implementation's token through `forRoot()` is what lets it bind inside the
right scope.

### Going to a database-backed channel config

```typescript
// In the consuming project, not in this library:
export const APPLICATION_ID = Symbol('APPLICATION_ID'); // your own token — not exported by this library, see the note below

class DatabaseNotificationChannelConfig implements NotificationChannelConfig {
  constructor(
    private readonly db: SomeLooselyTypedDrizzleDb,
    @Inject(APPLICATION_ID) private readonly applicationId: string,
  ) {}

  async channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    // Tenant-specific row first (a tenant that overrides the deployment default),
    // falling back to the tenant-less row (tenantId IS NULL) — the deployment default.
    // application_id is written on insert (see the seed/admin write path, not shown
    // here), never filtered on read — see the note below.
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

**Stamp `application_id` on the table, but don't query by it.** Unlike
`tenantId`, this is never a real parameter on `channelsFor()` — every row this
query ever sees already belongs to this one app's own database, so there's
nothing to disambiguate at read time, and adding it as an active *query*
parameter with no reader would be the exact mistake corrected elsewhere in
this repo (see `domain-events`' `application`). But `notificationChannelConfigTable`
should still carry an `application_id` column, populated when a row is
inserted — free while the table doesn't exist yet, and it removes an
otherwise-necessary backfill migration if this data is ever consolidated for
cross-app analytics or reporting later (see `MODULE-STANDARD.md` dimension 4).
`APPLICATION_ID` above supplies the value into this class's own constructor —
**your own token, declared in your own module, alongside this class**, not
exported by this library and not something `forRoot()` provides: nothing here
ever injects a value by a fixed "application id" name, so there's no shared
token to import, only a naming *convention* to follow if you like. It has to
be provided in the same module as `DatabaseNotificationChannelConfig` itself
— that class is constructed in a module `forRoot()` only imports *from*, so
nothing bound inside `forRoot()` could ever reach it (the exact NestJS
per-module scoping reason "Swapping one piece..." above already explains for
the override tokens themselves).

Use the core/raw query builder (`db.select().from(table)`), not the relational
query API (`db.query.table.findFirst()`) — the latter requires the `db` client's
own type to be parameterized with this specific table's schema, which would force
this class to know about the consuming project's full schema. The core builder
works against any table object regardless of the client's own schema generic, so
`DatabaseNotificationChannelConfig` never needs to know anything about
`ascendra-pay`'s (or any other project's) other tables. Provide it under your own
token, in your own module, and pass that token to `forRoot()`:

```typescript
export const DATABASE_CHANNEL_CONFIG = Symbol('DATABASE_CHANNEL_CONFIG');

@Module({
  providers: [
    { provide: APPLICATION_ID, useValue: 'ascendra-pay' }, // same module as the class that injects it — see above
    { provide: DATABASE_CHANNEL_CONFIG, useClass: DatabaseNotificationChannelConfig },
  ],
  exports: [DATABASE_CHANNEL_CONFIG],
})
export class MyNotificationProvidersModule {}
```

```typescript
NotificationModule.forRoot({
  channelConfigToken: DATABASE_CHANNEL_CONFIG,
  imports: [MyNotificationProvidersModule],
  // emailTemplates/smsTemplates unaffected — still static, still required, unless those get their own token too
})
```

This only stays clean as long as the channel-config table remains generic. The
moment a project needs to extend it (an audit column, a join against
project-specific data), that's the natural point to fork into a fully
project-owned table and implementation instead.

### Going to a database-backed template repository

Same shape as channel config, same reasoning for why it's generic-safe (core
query builder, not the relational API) — and the same "stamp `application_id`
on the table, never query by it" practice applies to `notificationTemplateTable`
too, for the identical reason (see the note above `DatabaseNotificationChannelConfig`).

```typescript
// In the consuming project, not in this library:
class DatabaseNotificationTemplateRepository implements NotificationTemplateRepository {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {}

  async templateFor(notificationType: string, tenantId: string | null): Promise<NotificationTemplate | null> {
    // Same tenant-specific-row-first, fall-through-to-deployment-default shape
    // as DatabaseNotificationChannelConfig above.
    const rows = await this.db.select().from(notificationTemplateTable)
      .where(and(
        eq(notificationTemplateTable.notificationType, notificationType),
        tenantId
          ? inArray(notificationTemplateTable.tenantId, [tenantId, null])
          : isNull(notificationTemplateTable.tenantId),
      ))
      .orderBy(desc(notificationTemplateTable.tenantId));
    return rows[0] ?? null;
  }
}
```

Each channel needs its **own** table/token/binding, exactly the way
`StaticNotificationTemplateRepository` gets two separate instances today — a
white-labeled tenant's email copy and SMS copy are independent content, not
one shared row:

```typescript
NotificationModule.forRoot({
  channels: { /* still static, unaffected */ },
  emailTemplateRepositoryToken: DATABASE_EMAIL_TEMPLATES,
  smsTemplateRepositoryToken: DATABASE_SMS_TEMPLATES,
  imports: [MyNotificationProvidersModule], // exports both tokens
})
```

### Going to a database-backed provider config

Same shape again, same reasoning for why it's generic-safe. The one real
difference from `DatabaseNotificationChannelConfig`/
`DatabaseNotificationTemplateRepository`: those two fall through a
tenant-specific row to a tenant-less deployment default (`tenantId IS NULL`);
a credentials table usually shouldn't, since "no credentials for this tenant"
is a configuration error worth surfacing as `'no_provider_config'`, not a
silent fallback to some other tenant's account. If a deployment genuinely
wants a shared default provider account, model that explicitly (a real row
with a sentinel tenant value your own code chooses), not as an implicit `NULL`
fallback:

```typescript
// In the consuming project, not in this library:
class DatabaseEmailProviderConfig implements ProviderConfigResolver<EmailProviderConfig> {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {}

  async configFor(tenantId: string | null): Promise<EmailProviderConfig | null> {
    if (tenantId === null) return null; // same "nothing to look up" answer as StaticProviderConfigResolver
    const rows = await this.db.select().from(emailProviderConfigTable)
      .where(eq(emailProviderConfigTable.tenantId, tenantId));
    return rows[0] ?? null;
  }
}
```

Each channel needs its **own** table/token/binding, exactly like the template
repositories — a tenant's email provider account and SMS provider account are
independent credentials, not one shared row. `application_id`, if this table
is ever consolidated for cross-app reporting, follows the same "stamp on
insert, never query by it" practice as `notificationChannelConfigTable` above
— though note this table holds live credentials, so it's a stronger candidate
for per-app *separation* than for cross-app consolidation in the first place.

```typescript
NotificationModule.forRoot({
  channels: { /* ... */ },
  emailTemplates: { /* ... */ },
  smsTemplates: { /* ... */ },
  emailProviderConfigToken: DATABASE_EMAIL_PROVIDER_CONFIG,
  smsProviderConfigs: { /* still static, unaffected */ },
  whatsappProviderConfigs: { /* still static, unaffected */ },
  imports: [MyNotificationProvidersModule],
})
```

### Going to a real `UserContactResolver`

Structurally the same token mechanism, but a different *kind* of choice than
the two above: `NullUserContactResolver` isn't a genuine long-term Model 1
some deployments keep forever the way a static channel/template map might be —
it's a bootstrapping placeholder. Most real deployments with actual internal
users (issuer staff, platform admins) need a real resolver quickly, not as an
optional upgrade path.

```typescript
// In the consuming project, not in this library:
class DrizzleUserContactResolver implements UserContactResolver {
  constructor(private readonly db: SomeLooselyTypedDrizzleDb) {}

  async findById(id: string): Promise<{ email?: string; phone?: string } | null> {
    const rows = await this.db.select({ email: users.email, phone: users.phone })
      .from(users).where(eq(users.id, id));
    return rows[0] ?? null;
  }
}
```

```typescript
NotificationModule.forRoot({
  channels: { /* ... */ },
  emailTemplates: { /* ... */ },
  smsTemplates: { /* ... */ },
  userContactResolverToken: DRIZZLE_USER_RESOLVER,
  imports: [MyNotificationProvidersModule],
})
```

## What's not built yet

- No real `WhatsappNotificationSender` — needs its own template shape first (see above).
- No database-backed `NotificationChannelConfig`/`NotificationTemplateRepository`/
  `ProviderConfigResolver` shipped here — the pattern for building one is
  documented above, but the actual class belongs in each consuming project
  once it's actually needed.
- No real email/SMS/WhatsApp delivery — every sender resolves real per-tenant
  provider credentials via `ProviderConfigResolver` now, but still only logs
  the rendered message (with the resolved `fromAddress`/`fromNumber`) instead
  of calling a real provider's API. Swapping that in means changing what each
  sender's `send()` does internally with the config it already has, not
  anything about `Notifier`, the channel config, the templates, or how
  credentials are resolved.
