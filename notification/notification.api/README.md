# `notification.api` — HTTP endpoints for admin + observability

Opt-in NestJS controllers for a "did it send / edit the config" admin UI, over
the `notification.core.database` **ports** + `Notifier`. Stack-agnostic — it
never imports a stack adapter; it's wired to one at the vertical via injection
tokens.

## Endpoints

| Method | Path | Gate | → |
|---|---|---|---|
| GET | `/notifications/deliveries` | `notification.view` | `getDeliveryHistory` (paginated, filtered) |
| GET | `/notifications/deliveries/:id/content` | `notification.view` | `getDeliveryContent` (404 if not stored) |
| GET | `/notifications/config/coverage-gaps` | `notification.view` | `configCoverageGaps` |
| GET | `/notifications/config/routes` \| `/templates` \| `/credentials` | `notification.view` | `list*` (credentials redacted — channel+tenant only) |
| PUT/DELETE | `/notifications/config/routes` | `notification.manage_config` | `setChannelRoute` / `deleteChannelRoute` (actor-scoped) |
| PUT/DELETE | `/notifications/config/templates` | `notification.manage_config` | `setTemplate` / `deleteTemplate` (actor-scoped) |
| PUT/DELETE | `/notifications/config/credentials` | `notification.manage_config` | `setProviderCredential` (takes the opaque blob) / `deleteProviderCredential` (actor-scoped) |
| POST | `/notifications/test-send` | `notification.test_send` | `Notifier.notify()` — a real send to verify config |

Gate names are fixed. A vertical whose catalog uses different names grants its
admin role these too.

## The `.api` service layer

Controllers are thin. The `*ApiService` classes hold:

- **Tenant ceiling** — a non-platform admin may only touch rows for **their own
  tenant**; a `null` tenantId (deployment default) is platform-admin only.
  test-send is likewise pinned to the actor's tenant.
- **Audit emission** — each config mutation emits a `NotificationAuditEvent`
  through the optional `NOTIFICATION_AUDIT_EMITTER` (no-op if unbound; **no**
  dependency on `audit-logging`). The credential *value* is never in the event.

"Platform admin" defaults to `actor.tenantId === null`; override via
`forRoot({ isPlatformAdmin })`.

## Wiring

```typescript
import { NotificationApiModule } from '.../notification.api';
import {
  PostgresNotificationAdminModule,
  PostgresNotificationConfigModule,
} from '.../notification.core.database.postgres-drizzle';

@Module({
  imports: [
    NotificationModule.forRoot({
      configToken: POSTGRES_NOTIFICATION_CONFIG,
      imports: [PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
    NotificationApiModule.forRoot({
      auditEmitterToken: MY_AUDIT_EMITTER,       // optional
      imports: [
        PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
        PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }), // re-list so NOTIFIER's config is visible if needed
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

**Requires `AuthorizationGuard` as a global `APP_GUARD`** — the endpoints declare
`@RequiresAction` and rely on the global guard.

## Depends on

`notification.core`, `notification.core.database` (ports + DTOs), and
`authorization.core` (guard, `@RequiresAction`, `CurrentActor`, `Actor`).
**Never** a stack adapter. React/Next.js is out of scope — `ascendra-commons-ui`.
