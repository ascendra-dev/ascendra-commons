# `domain-events.api` — HTTP read endpoints for an event-delivery admin screen

Opt-in NestJS controller over `EVENT_DELIVERY_OBSERVABILITY_PORT` (the runtime
delivery log) and `EVENT_LISTENER_CATALOG_PORT` (the static "what listens to
what" wiring map). Stack-agnostic — it never imports a stack adapter; it's
wired to one at the vertical via `imports`. **Read-only** — deliveries are
write-once and the listener catalogue is a live read, so there's no mutation
surface and no admin emitter.

**Delivery only, never a listener outcome.** Every endpoint here answers "did
the event fire, and was anyone listening" — never "what happened after."
Whether a listener's own handling then succeeded (the audit record actually
wrote, the notification actually sent) is that listener's own module's
concern, surfaced through `audit-logging.api` / `notification.api`, not here.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/domain-events/deliveries` | `listDeliveries(DeliveryQuery)` — query params: `eventName`, `method`, `status`, `correlationId`, `since`, `until`, `limit`, `cursor`. Returns `DeliveryPage` (newest-first + `nextCursor`) unchanged. |
| GET | `/domain-events/deliveries/trace/:correlationId` | every delivery from one request / job run — a cross-module trace, joinable with `audit-logging.api`'s and `notification.api`'s own trace endpoints on the same id. |
| GET | `/domain-events/deliveries/catalog` | one row per event name that has ever fired — totals, "fired with zero listeners" count, "transport itself failed" count, last-seen time. |
| GET | `/domain-events/listener-catalog` | every `@OnEvent()`/`@OnCriticalEvent()` binding discovered in the running app — event name, listener class + method, whether critical. Independent of whether the event has ever fired. |

All gated on `@RequiresAction('domain-events.view')`. No tenant scoping —
`domain-events` has no `tenantId`, same posture `background-jobs.api` takes.

## Reading the two catalogs together

`deliveries/catalog` (what has actually happened) and `listener-catalog` (what
the code says should happen) are deliberately separate reads, not
pre-joined — cross-referencing them client-side catches two different bugs:

- an event name in `listener-catalog` that never appears in `deliveries/catalog`
  — a listener wired to an event nobody ever raises (dead code, or a producer-side typo).
- an event name in `deliveries/catalog` with no matching entry in
  `listener-catalog` — the same signal `deliveries/catalog`'s own
  `noListenerCount` already gives per-delivery, confirmed independently by the
  static wiring map.

## Wiring

```typescript
import { DomainEventsApiModule } from '.../domain-events.api';
import { PostgresEventDeliveryObservabilityModule } from '.../domain-events.core.postgres-drizzle';

@Module({
  imports: [
    DomainEventsApiModule.forRoot({
      imports: [
        PostgresEventDeliveryObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
        // InProcessDomainEventEmitterModule.forRoot(...) exports EVENT_LISTENER_CATALOG_PORT — import it here too if it isn't otherwise visible.
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`domain-events.core` (both ports + DTOs), and `authorization.core` (guard,
`@RequiresAction`). Never a stack adapter. The frontend belongs in
`ascendra-commons-ui`.
