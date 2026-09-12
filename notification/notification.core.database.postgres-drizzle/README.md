# `notification.core.database.postgres-drizzle` — Model 2 / Postgres

The Postgres + Drizzle stack adapter. It implements three things over
`commons_notification_*`:

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `config/` | `NotificationConfig` (routing / templates / credentials, TTL-cached) | `POSTGRES_NOTIFICATION_CONFIG` | `NotificationModule.forRoot({ configToken })` |
| `delivery-log/` | `NotificationDeliveryRecorder` (batched INSERT + webhook UPDATE) | `POSTGRES_NOTIFICATION_DELIVERY_RECORDER` | `NotificationModule.forRoot({ deliveryRecorderToken })` |
| `admin/` | `NotificationObservabilityPort` + `NotificationConfigAdminPort` | `NOTIFICATION_OBSERVABILITY_PORT` / `NOTIFICATION_CONFIG_ADMIN_PORT` (family tokens) | `PostgresNotificationAdminModule.forRoot(...)` |
| `persistence/` | `config.schema.ts` + `delivery.schema.ts` (Drizzle) + hand-kept `.migration.sql` — **keep in sync** | | |
| `seed/` | `seedNotificationConfigFromData(db, application, data)` — behaviour-preserving `static` → `database` | | |

The resolver algorithm, the `ConfigCache`, the cursor helper, and the admin
ports/DTOs are stack-agnostic and live in `notification.core.database`.

## Wiring

### 1. Tables

```typescript
export * from 'src/ascendra-commons/notification/notification.core.database.postgres-drizzle';
```

…or copy `persistence/config.migration.sql` + `persistence/delivery.migration.sql`.
**Requires PostgreSQL 15+** (`NULLS NOT DISTINCT`).

### 2. Seed the deployment defaults

```typescript
import { seedNotificationConfigFromData } from '.../notification.core.database.postgres-drizzle';

await seedNotificationConfigFromData(db, 'ascendra-pay', {   // same `application` as forRoot()
  channels: { 'invoice.sent': ['email'] },
  templates: { email: { 'invoice.sent': { subject: '...', body: '...' } } },
  providerConfigs: { email: { 'tenant-a': { apiKey: '...' } } },
});
```

### 3. Flip the model (+ optional delivery log + admin)

```typescript
NotificationModule.forRoot({
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,   // optional
  imports: [
    PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    PostgresNotificationDeliveryRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', storeContent: false, imports: [DatabaseModule] }),
  ],
}),
PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

`Notifier`, the senders, every call site — unchanged.

## `application` scoping

Every row carries `application` and every read/write filters `WHERE application = $1`
(from `forRoot({ application })`). Constant within one app's own database, so it
costs nothing there — but it keeps the tables correct if all Ascendra apps'
notification config is ever consolidated into one shared database.

## Credentials — one opaque `config` jsonb

Returned **verbatim** as `ProviderConfig`; the library never reads inside it.
It typically holds live secrets — **encrypt at rest** (Supabase Vault, `pgcrypto`
+ decrypting view, or `REVOKE select` from the ordinary read role).

## `storeContent` (delivery log)

`PostgresNotificationDeliveryRecorderModule.forRoot({ storeContent: true })` →
the `content` jsonb column gets the rendered `{ subject, body, isHtml, variables }`.
**Default off** — full-fidelity PII, pruned with the row. Read one row's content
with `NotificationObservabilityPort.getDeliveryContent(id)`.

## Retention

The consumer's (`DELETE … WHERE attempted_at < now() - interval '90 days'`, or a
`ScheduledJob`).

## Depends on

`notification.core.database` (+ `notification.core` transitively), `@nestjs/common`,
`drizzle-orm` (`drizzle-orm/pg-core`).
