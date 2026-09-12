# `notification.core.static` — Model 1

Channel routing, templates, and delivery credentials from an in-memory object.
No database, no admin surface, no migration. This is what most single- or
few-tenant deployments stay on.

## The model

```typescript
StaticNotificationConfigModule.forRoot({
  channels: {
    'invoice.sent': ['email'],
    'payment.confirmed': ['email', 'sms'],
  },
  templates: {
    email: { 'invoice.sent': { subject: 'Invoice {{invoiceNumber}} ready', body: '...' } },
  },
  providerConfigs: {
    email: { 'tenant-a': { apiKey: 'sg-...', from: 'billing@tenant-a.com' } },
  },
})
```

- `channels` required — an unconfigured `notificationType` → zero channels (`no_channel_configured`).
- `templates` / `providerConfigs` optional — a missing entry is a graceful per-send failure.
- **`tenantId` asymmetry:** `channelsFor` / `templateFor` ignore it (one config for the deployment); `providerConfigFor` honors it (one tenant, one provider account; `null` → `null`).

## Wiring

```typescript
NotificationModule.forRoot({
  configToken: STATIC_NOTIFICATION_CONFIG,
  imports: [StaticNotificationConfigModule.forRoot({ channels: { ... }, templates: { ... }, providerConfigs: { ... } })],
})
```

## When to move to Model 2

When one tenant needs different routing, white-labeled templates, or you want a
DB-editable config with an admin screen — `notification.core.database` +
`notification.core.database.postgres-drizzle`. Its `seedNotificationConfigFromData`
takes this same `channels`/`templates`/`providerConfigs` shape, so the switch is
behaviour-preserving until you add tenant override rows.

**Going database-backed for one method only:** `extends StaticNotificationConfig`,
override just `channelsFor`/`templateFor` to hit your DB, leave `providerConfigFor`
reading the static `providerConfigs` — no secrets in the routing DB. Bind the
subclass under `NotificationModule.forRoot({ configToken })`.

## Depends on

`notification.core`, `@nestjs/common`.
