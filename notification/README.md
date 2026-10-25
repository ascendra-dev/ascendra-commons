# Notification Pattern

Inform users of events (invoice sent, payment received, reminders due) without
embedding notification logic in feature code. One notification type fans out to
one or more channels (email, WhatsApp, SMS), configurably; a channel's identity
is fixed by business intent from day one, independent of whether its real
delivery mechanism exists yet.

Split into independently-vendored packages along the seams every consumer
chooses between. Copy the sub-folders you need into
`src/ascendra-commons/notification/`.

## The packages

| Package | Role | Depends on |
|---|---|---|
| **`notification.core`** | `Notifier` (the one thing feature code depends on), the `NotificationConfig` / `NotificationSender` / `NotificationDeliveryRecorder` / `UserContactResolver` interfaces, the three **stub senders**, `Noop`/`Null` defaults, `renderTemplate`, `NotificationModule.forRoot({ configToken })` (token wiring only). | — |
| **`notification.core.static`** | **Model 1** — channel routing / templates / credentials from an in-memory object (`StaticNotificationConfig`). | `notification.core` |
| **`notification.core.database`** | **Model 2 family** — stack-agnostic: `ConfigCache`, keyset-cursor helper, the admin/observability **ports** + DTOs. No SQL. | `notification.core` |
| **`notification.core.database.postgres-drizzle`** | **Model 2 / Postgres** — implements `NotificationConfig` + `NotificationDeliveryRecorder` + the admin ports; schema, migrations, seed. A `…mysql-drizzle` etc. slots in beside it. | `notification.core.database` |
| **`notification.api`** | Opt-in HTTP endpoints for a delivery-log / config-editing / test-send admin UI, over the family ports + `Notifier`. | `notification.core`, `notification.core.database`, `authorization.core` |

Dependency direction is one-way toward `.core`.

## Choosing a model

```typescript
// Model 1 — the default
NotificationModule.forRoot({
  configToken: STATIC_NOTIFICATION_CONFIG,
  imports: [StaticNotificationConfigModule.forRoot({
    channels: { 'invoice.sent': ['email'], 'payment.confirmed': ['email', 'sms'] },
    templates: { email: { 'invoice.sent': { subject: '...', body: '...' } } },
    providerConfigs: { email: { 'tenant-a': { apiKey: '...', from: '...' } } },
  })],
})

// Model 2 — per-tenant routing / white-labeled templates / DB-editable config, on Postgres
NotificationModule.forRoot({
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,   // optional delivery log
  imports: [
    PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    PostgresNotificationDeliveryRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
  ],
})
```

Both wire identically — a token plus the module that provides it. `Notifier`,
the senders, every call site are unchanged. `seedNotificationConfigFromData`
takes the same `channels`/`templates`/`providerConfigs` shape, so the switch is
behaviour-preserving until you add tenant override rows.

**When to move from Model 1 to Model 2:** when one tenant needs different
routing, white-labeled templates, or you want a DB-editable config with an admin
screen.

## The pieces (in `notification.core`)

- **`Notifier`** — `notify()` never throws; dispatches to each channel's
  `NotificationSender` in parallel; aggregates `sent` / `partial` / `failed`
  with the full per-channel breakdown. `notifyCritical()` is the throwing
  counterpart.
- **`NotificationConfig`** — `channelsFor` / `templateFor` / `providerConfigFor`,
  each taking `tenantId`. Model 1's `tenantId` asymmetry (routing/templates
  deployment-wide, credentials per-tenant) is documented in `notification.core.static`.
- **`NotificationSender`** — one per channel. The three shipped are **stubs**
  (render + a redacted log line). Plug in a real one per channel with
  `NotificationModule.forRoot({ senders: { email: SesEmailSender } })` — the class is
  built inside the module, so it injects `NOTIFICATION_CONFIG` (credentials, templates)
  and `USER_CONTACT_RESOLVER`; never a change to `Notifier`, `NotificationConfig`, or
  templates. A shared one may later ship as `notification.<channel>.<provider>`.
- **`NotificationDeliveryRecorder`** — the delivery-log port; `Noop` by default,
  the Postgres impl opt-in via `deliveryRecorderToken`. `recipientRef` is
  redacted; `content` (rendered message) is stored only with `storeContent: true`.
- **`UserContactResolver`** — resolves a `'user'` recipient's address against the
  consumer's user table; `Null` by default, overridden via
  `userContactResolverToken`.

## `applicationId` / `tenantId`

No `applicationId` in the core `NotificationConfig` — dispatch and rendering
never need it. The **Postgres adapter** carries an `application` column on every
table and filters every read by it (constant within one app's DB, keeps the
tables correct if config is ever consolidated). `tenantId` *is* a real parameter
on `NotificationRequest` and every `NotificationConfig` method.

## What's not built yet

- No real senders (every stub still only logs).
- No real `WhatsappNotificationSender` — needs its own Meta-side template shape.
- The frontend for the admin UI — `ascendra-commons-ui`.
