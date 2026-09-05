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
| `audit-event.schema.ts` | Drizzle `pgTable` for `audit_event` — the source of truth for the reference schema. `export` it from your own schema barrel to let `drizzle-kit generate` produce the migration. |
| `audit-event.migration.sql` | The same table as hand-written DDL — paste into your migration tooling if you don't route this through `drizzle-kit`. |
| `postgres-audit-event.repository.ts` | `PostgresAuditEventRepository` — one `INSERT`, `application` stamped on write. |
| `postgres-audit-persistence.module.ts` | `PostgresAuditPersistenceModule.forRoot(...)` — binds the repo to your db token and exports it as `POSTGRES_AUDIT_EVENT_REPOSITORY`. |
| `sql-executor.ts` | The minimal db shape the repo needs (`execute(sql)`), so this adapter never imports your generated schema. |

## Consuming it

### 1. Create the table

Either export the Drizzle table so `drizzle-kit` picks it up:

```typescript
// src/db/schema.ts  (your project)
export { auditEventTable } from 'src/ascendra-commons/audit-logging/adapters/postgres-drizzle';
```

…or copy `audit-event.migration.sql` into your migrations directory. Both
produce the same `audit_event` table plus its two indexes.

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

## Notes

- **`application` is a plain string, not `domain-events`' `APPLICATION_ID`
  token.** Pass the same value you give `DomainEventsModule.forRoot({ application })`
  if you set that. Kept as a value here so the adapter works whether or not that
  token is bound and exported.
- **The `application` column is stamped on insert, never read back by this
  adapter** — passive metadata (see `MODULE-STANDARD.md` dimension 4). It exists
  so a future cross-product compliance-reporting consolidation doesn't need a
  backfill migration.
- **Write-once.** The repository exposes `insert()` only. To enforce it at the
  database too, `REVOKE update, delete ON audit_event` from the app role.
- **Keep the three table definitions in sync** — `audit-event.schema.ts`, the
  column list in `postgres-audit-event.repository.ts`, and
  `audit-event.migration.sql` all describe one table.
- **No `find()` / read path** — same as the module core. `AuditEventRepository`
  is write-only today; see the module README's "Not built: reading audit
  records" for the deferred `AuditQuery` shape.
