# Audit Logging — Postgres/Drizzle adapter

A ready-made `AuditEventRepository` for the common Ascendra stack (Postgres +
Drizzle), so a consuming project on that stack writes **no persistence code** —
it hands this adapter its existing database connection and an application name,
and passes the adapter's token to `AuditLoggingModule.forRoot()`.

The `audit-logging/` module core stays stack-agnostic: it ships the port
(`AuditEventRepository`), never an implementation. This folder is one concrete
implementation of that port; a project on a different stack (a different ORM, a
different database, an external audit sink) ignores this folder and provides its
own `AuditEventRepository` instead — the wiring below is identical apart from
which token/module goes into `forRoot()`.

## What's in here

| File | What it is |
|---|---|
| `audit-event.schema.ts` | Drizzle `pgTable` for `commons_audit_event` — the source of truth for the reference schema. `export` it from your own schema barrel to let `drizzle-kit generate` produce the migration. |
| `audit-event.migration.sql` | The same table as hand-written DDL — paste into your migration tooling if you don't route this through `drizzle-kit`. |
| `postgres-audit-event.repository.ts` | `PostgresAuditEventRepository` — one `INSERT`, `application` stamped on write. |
| `postgres-audit-persistence.module.ts` | `PostgresAuditPersistenceModule.forRoot(...)` — binds the repo to your db token and exports it as `POSTGRES_AUDIT_EVENT_REPOSITORY`. |
| `postgres-audit-event-reader.ts` | `PostgresAuditEventReader` — read-only `find(query)` for a compliance/ops admin screen. |
| `postgres-audit-observability.module.ts` | `PostgresAuditObservabilityModule.forRoot(...)` — binds the reader, exports `POSTGRES_AUDIT_EVENT_READER`. |
| `sql-executor.ts` | The minimal db shape the repo needs (`execute(sql)`), so this adapter never imports your generated schema. |

## Consuming it

### 1. Create the table

Either export the Drizzle table so `drizzle-kit` picks it up:

```typescript
// src/db/schema.ts  (your project)
export { auditEventTable } from 'src/ascendra-commons/audit-logging/adapters/postgres-drizzle';
```

…or copy `audit-event.migration.sql` into your migrations directory. Both
produce the same `commons_audit_event` table plus its two indexes.

### 2. Wire the modules

```typescript
import { AuditLoggingModule } from 'src/ascendra-commons/audit-logging';
import {
  PostgresAuditPersistenceModule,
  POSTGRES_AUDIT_EVENT_REPOSITORY,
} from 'src/ascendra-commons/audit-logging/adapters/postgres-drizzle';
import { DomainEventsModule } from 'src/ascendra-commons/domain-events';

@Module({
  imports: [
    DomainEventsModule.forRoot(),

    AuditLoggingModule.forRoot({
      auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
      imports: [
        PostgresAuditPersistenceModule.forRoot({
          sqlExecutorToken: DATABASE_CONNECTION, // whatever token your Drizzle db is provided under
          application: 'ascendra-pay',           // stamped into every audit row's `application` column
          imports: [DatabaseModule],             // the module that exports DATABASE_CONNECTION
        }),
      ],
    }),
  ],
})
export class AppModule {}
```

That's the whole persistence setup. `AuditListener` (shipped by
`AuditLoggingModule.forRoot()`) now writes every `AuditRecordRaised` through
`PostgresAuditEventRepository`. The producer side is unchanged — see the module
README's "raising an audit record" example.

### 3. (optional) Reading records back — `PostgresAuditObservabilityModule`

Independent of the persistence module — import either or both (both take the
same `sqlExecutorToken` / `application`):

```typescript
import {
  PostgresAuditObservabilityModule,
  POSTGRES_AUDIT_EVENT_READER,
} from 'src/ascendra-commons/audit-logging/adapters/postgres-drizzle';
import type { AuditEventReader } from 'src/ascendra-commons/audit-logging';

PostgresAuditObservabilityModule.forRoot({
  sqlExecutorToken: DATABASE_CONNECTION, // normal pooled db — reads only
  application: 'ascendra-pay',
  imports: [DatabaseModule],
})
```

`AuditEventReader.find(query)` — `query` fields are all optional and ANDed:
`entityType`+`entityId` ("this record's history"), `tenantId` (absent = no
filter; `null` = platform-level only), `actor`, `action`, `correlationId`
("everything in one request" — a cross-module trace when jobs / notifications
also record the id), `occurredAfter` / `occurredBefore`, `limit` (default 50,
max 200), `cursor`. Returns `{ records, nextCursor? }`, newest first,
keyset-paginated. Read-only — the write-once guarantee is unaffected.

The endpoint is yours (`ascendra-commons` ships no controllers), gated with
your own `Authorizer` on a dedicated action (e.g. `'audit.view'`, restricted
to a platform/compliance persona — never a tenant user). The reader is scoped
to one `application`; a cross-product compliance view that needs every app's
rows queries `commons_audit_event` directly.

## Notes

- **`application` is a plain string, not `domain-events`'
  `DOMAIN_EVENTS_APPLICATION_ID` token.** Pass the same value you give
  `DomainEventsModule.forRoot({ application })` if you set that. Kept as a value
  here so the adapter works whether or not that token is bound and exported.
- **The `application` column** is stamped on insert by
  `PostgresAuditEventRepository` and filtered on (`application = $1`) by
  `PostgresAuditEventReader`, scoping an app's own admin screen to its own
  rows. Constant within one app's database; the column keeps
  `commons_audit_event` correct if history is ever consolidated into one shared
  compliance database (see `MODULE-STANDARD.md` dimension 4).
- **Write-once.** `AuditEventRepository` exposes `insert()` only; `find()` is a
  separate `AuditEventReader` port that never mutates. To enforce it at the
  database too, `REVOKE update, delete ON commons_audit_event` from the app role.
- **Keep the three table definitions in sync** — `audit-event.schema.ts`, the
  column list in `postgres-audit-event.repository.ts`, and
  `audit-event.migration.sql` all describe one table. `postgres-audit-event-reader.ts`
  reads a subset of the same columns.
