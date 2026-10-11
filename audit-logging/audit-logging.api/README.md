# `audit-logging.api` — HTTP read endpoints for a compliance / ops screen

Opt-in NestJS controller over the `AUDIT_EVENT_READER` port. Stack-agnostic —
it never imports a stack adapter; it's wired to one at the vertical via `imports`.
**Read-only** — audit records are write-once, so there's no mutation surface and
no audit-emitter.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/audit/events` | `find(AuditQuery)` — query params: `entityType`, `entityId`, `tenantId`, `actor`, `action`, `correlationId`, `occurredAfter`, `occurredBefore`, `limit`, `cursor`. Returns api-contract.md's cursor list shape: `{ data, meta: { nextCursor } }` (records newest-first; `nextCursor` omitted on the last page), mapped from the core's `AuditQueryResult` in the controller. |
| GET | `/audit/events.csv` | Same `AuditQuery` filters as `/audit/events`, rendered as CSV (`text/csv`) instead of JSON — one bounded page, for a small ad-hoc export. No async/large-range export job (that writes to `file-storage`) is built here. |
| GET | `/audit/events/:id` | `findOne(id)` — one record plus its server-computed field-level `diff` (`AuditEventDetail`, via `diffFields`). 404s (never leaks existence) for a missing or cross-tenant id. |
| GET | `/audit/entities/:type/:id/history` | one entity's full audit history, paginated. Same `{ data, meta: { nextCursor } }` shape as `/audit/events`. |
| GET | `/audit/trace/:correlationId` | every record from one request / job run — a cross-module trace. Same `{ data, meta: { nextCursor } }` shape as `/audit/events`. |
| GET | `/audit/actors/:actor/activity` | `summarizeActor(actor, query)` — counts by action, first/last seen, distinct tenants touched. Query params: `occurredAfter`, `occurredBefore`. |
| GET | `/audit/stats` | `stats(window, tenantFilter)` — the Overview dashboard: `perDay`/`topActions`/`topActors`/`perTenant`. Query params: `window` (e.g. `'30d'`, default 30 days), `tenantId` (platform admin only). |
| GET | `/audit/catalog` | The app's audit vocabulary configured via `forRoot({ catalog })` — `{ entityType, actions }[]`, a bare array (api-contract.md Rule 4's bounded case). Not tenant-scoped (it's vocabulary, not data); `[]` when none is configured. Meant for populating filter selects. |
| POST | `/audit/coverage` | `countByDeclared({ entityTypes, actions })` — body is the caller's own declared catalog; an empty body (or none) uses the configured `catalog` instead. Response is a per-declared-entry `{ kind, value, count, assessment }[]`, no catalog table involved. |

All gated on `@RequiresAction('audit.view')`.

`GET /audit/retention` (oldest record, row count, table size) is deliberately **not** built — see the module's `mocks.html` Retention & Volume screen, left `proposed`.

## Actor scoping

A **non-platform actor's** reads are forced to their own `tenantId` — a
per-tenant activity feed. A **platform admin** (default: `actor.tenantId === null`,
override via `forRoot({ isPlatformAdmin })`) reads every tenant's records, and
may filter by any `tenantId` or `tenantId=null` (platform-level rows). A
vertical that wants audit reads to be platform-admin-only just doesn't grant
`audit.view` to tenant personas. Every endpoint added above follows the same
rule — including `/audit/events/:id`, where a cross-tenant id 404s exactly
like a missing one, so a non-platform actor can never distinguish "doesn't
exist" from "not yours".

## Wiring

```typescript
import { AuditApiModule } from '.../audit-logging.api';
import { PostgresAuditObservabilityModule } from '.../audit-logging.core.postgres-drizzle';

@Module({
  imports: [
    AuditApiModule.forRoot({
      imports: [PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`audit-logging.core` (the reader port + DTOs), and `authorization.core`
(guard, `@RequiresAction`, `CurrentActor`, `Actor`). Never a stack adapter.
The frontend belongs in `ascendra-commons-ui`.
