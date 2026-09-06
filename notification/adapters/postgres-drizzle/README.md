# Notification — Postgres/Drizzle adapter (Model 2)

A database-backed `NotificationConfig` for the common Ascendra stack. A project
on this stack gets per-tenant channel routing and white-labeled templates
without writing any resolution code — it points the adapter at its DB
connection, runs the migration, seeds the deployment defaults from its existing
static config, and flips `NotificationModule.forRoot({ model })` to
`'database'`.

The `notification/` core stays stack-agnostic: it ships the `NotificationConfig`
interface, `Notifier`, the senders. This folder is one concrete
implementation. A project on another stack ignores it and provides its own
`NotificationConfig`.

## What's in here

| File | |
|---|---|
| `schema.ts` | 3 Drizzle `pgTable`s — source of truth for the columns |
| `notification-config.migration.sql` | the same tables as DDL |
| `postgres-notification-config.ts` | `PostgresNotificationConfig` — the three-method implementation, behind a TTL cache |
| `postgres-notification-config.module.ts` | `forRoot({ sqlExecutorToken, cacheTtlSeconds?, imports })` → exports `POSTGRES_NOTIFICATION_CONFIG` |
| `seed-from-static-data.ts` | `seedNotificationConfigFromData(db, data)` — behaviour-preserving `model: 'static'` → `'database'` |
| `config-cache.ts` · `sql-executor.ts` · `sql-helpers.ts` · `tokens.ts` | plumbing |

## The tables

| Table | Method | Fall-through |
|---|---|---|
| `commons_notification_channel_route` | `channelsFor` | tenant row → `tenant_id IS NULL` deployment default |
| `commons_notification_template` | `templateFor` | tenant row → `tenant_id IS NULL` deployment default |
| `commons_notification_provider_credential` | `providerConfigFor` | **none** — a missing row is `no_provider_config`, never another tenant's account |

Resolution picks the tenant-specific row over the default with
`ORDER BY tenant_id IS NULL LIMIT 1` (`false` sorts first). A `null` tenantId
matches only the default rows; for credentials it short-circuits to `null` with
no query.

**Every row carries `application`** and every read filters `WHERE application = $1`
(stamped from `forRoot({ application })`). Constant within one app's own
database, so it costs nothing there — but it means these tables are also
correct if all Ascendra apps' notification config is ever consolidated into one
shared database (rows disambiguated, a notificationType like `invoice.sent`
that both `ascendra-pay` and `ascendra-erp` define stays distinct).

## Wiring it

### 1. Create the tables

Re-export the schema for `drizzle-kit`:

```typescript
// src/db/schema.ts
export * from 'src/ascendra-commons/notification/adapters/postgres-drizzle';
```

…or copy `notification-config.migration.sql`. **Requires PostgreSQL 15+**
(`NULLS NOT DISTINCT`).

### 2. Seed the deployment defaults

Once, at deploy time or in a migration — from your existing static config, so
the switch changes nothing until you add tenant override rows:

```typescript
import { seedNotificationConfigFromData } from '.../adapters/postgres-drizzle';

await seedNotificationConfigFromData(db, 'ascendra-pay', {   // same `application` as forRoot()
  channels: { 'invoice.sent': ['email'], 'payment.confirmed': ['email', 'sms'] },
  templates: { email: { 'invoice.sent': { subject: '...', body: '...' } } },
  providerConfigs: { email: { 'tenant-a': { apiKey: '...', from: 'billing@tenant-a.com' } } },
});
```

### 3. Flip the model

```typescript
import {
  PostgresNotificationConfigModule,
  POSTGRES_NOTIFICATION_CONFIG,
} from 'src/ascendra-commons/notification/adapters/postgres-drizzle';

NotificationModule.forRoot({
  model: 'database',
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  imports: [
    PostgresNotificationConfigModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      application: 'ascendra-pay',   // written on every row, filtered on every read
      cacheTtlSeconds: 30,           // optional, default 30; 0 disables
      imports: [DatabaseModule],
    }),
  ],
});
```

`Notifier`, the senders, every call site — unchanged. To switch back, restore
`model: 'static'` with the `channels`/`templates`/`providerConfigs` data.

### 4. Per-tenant overrides

After seeding, add rows with a real `tenant_id` through your own admin path —
an `INSERT`/`UPSERT` into `commons_notification_channel_route` / `commons_notification_template`
for that tenant. The adapter picks them up automatically (within the cache TTL).

## Caching

`Notifier.notify()` reads config on every send; a batch job doing hundreds of
notifications would repeat identical queries. `PostgresNotificationConfig` keeps
a **short per-process TTL cache** (default 30s, `cacheTtlSeconds: 0` disables) —
a routing/template/credential change is visible after at most the TTL. Not
shared across processes (no Redis); config changes rarely enough that a brief
per-node staleness window is fine.

## Credentials — one opaque `config` jsonb

`commons_notification_provider_credential.config` is a single `jsonb` column. The
adapter returns it **verbatim** as `ProviderConfig` — provider credential
shapes vary (a single API key; access key + secret + region; an OAuth token;
SID + auth token + number) and can't be anticipated, so the library never reads
inside it. Your real `send()` interprets it.

It typically holds live secrets — **encrypt at rest**:

- Supabase **Vault** (keep secret ids in the JSON, resolve them in a
  `PostgresNotificationConfig` subclass), or
- `pgcrypto` + a decrypting view, or
- `REVOKE select ON commons_notification_provider_credential` from the ordinary read
  role and grant it only to the notification service's role.

If your near-term need is only per-tenant *routing and templates*, skip this
table entirely: subclass `StaticNotificationConfig`, override
`channelsFor`/`templateFor` to hit the DB, and leave `providerConfigFor`
reading the static `providerConfigs` passed to `super()` (see the module
README, "Going database-backed for one method only").

## Deferred (not built)

- Admin UI for editing config rows.
- Config-change audit / versioning (emit an `AuditRecordRaised` from your
  admin write path).
- A shared "default provider account" — model it as a real sentinel `tenant_id`
  row your own code chooses, never a NULL fallback.
