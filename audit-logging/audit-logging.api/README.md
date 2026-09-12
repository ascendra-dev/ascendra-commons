# `audit-logging.api` — HTTP read endpoints for a compliance / ops screen

Opt-in NestJS controller over the `AUDIT_EVENT_READER` port. Stack-agnostic —
it never imports a stack adapter; it's wired to one at the vertical via `imports`.
**Read-only** — audit records are write-once, so there's no mutation surface and
no audit-emitter.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/audit/events` | `find(AuditQuery)` — query params: `entityType`, `entityId`, `tenantId`, `actor`, `action`, `correlationId`, `occurredAfter`, `occurredBefore`, `limit`, `cursor`. Returns `AuditQueryResult` (records newest-first + `nextCursor`) unchanged. |
| GET | `/audit/entities/:type/:id/history` | one entity's full audit history, paginated. |
| GET | `/audit/trace/:correlationId` | every record from one request / job run — a cross-module trace. |

All gated on `@RequiresAction('audit.view')`.

## Actor scoping

A **non-platform actor's** reads are forced to their own `tenantId` — a
per-tenant activity feed. A **platform admin** (default: `actor.tenantId === null`,
override via `forRoot({ isPlatformAdmin })`) reads every tenant's records, and
may filter by any `tenantId` or `tenantId=null` (platform-level rows). A
vertical that wants audit reads to be platform-admin-only just doesn't grant
`audit.view` to tenant personas.

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
