# `background-jobs.api` — HTTP endpoints for a jobs admin screen

Opt-in NestJS controller over `JOB_OBSERVABILITY_PORT` (reads) and `JobTrigger`
(the one action). Stack-agnostic — wired to a stack adapter at the vertical via
`imports`. **No tenant scoping** — `background-jobs` has no `tenantId` anywhere.

## Endpoints

| Method | Path | Gate | → |
|---|---|---|---|
| GET | `/jobs` | `job.view` | `listJobStatus()` — one row per job: last run, last success, consecutive failures, cadence, `overdue` flag |
| GET | `/jobs/:name/runs` | `job.view` | `getRunHistory({ jobName, outcome?, since?, until?, limit?, cursor? })` — keyset-paginated |
| GET | `/jobs/runs/trace/:correlationId` | `job.view` | `getRunHistory({ correlationId })` — every run from one request/job chain |
| POST | `/jobs/:name/run` | `job.run` | `JobTrigger.trigger(name)` — "run now" / "retry". Returns `JobTriggerResult` (`unknown_job` / `already_running` / `completed` / `job_failed`) |

Gate names are fixed. A vertical whose catalog uses different names grants its
ops role these too.

## The trigger

`POST /jobs/:name/run` is the one mutating endpoint — a manual, privileged job
run. If the vertical binds `auditEmitterToken`, each trigger emits a
`{ action: 'job.triggered', actorId, jobName, result }` event (no-op if unbound;
no hard dep on `audit-logging`).

`trigger()` awaits the whole run. For a long job, the vertical's own controller
can fire-and-forget instead; this endpoint always awaits (the advisory lock
still stops a double-click starting a second run).

## Wiring

```typescript
import { JobsApiModule } from '.../background-jobs.api';
import { PostgresJobObservabilityModule } from '.../background-jobs.core.postgres-drizzle';

@Module({
  imports: [
    BackgroundJobsModule.forRoot({ advisoryLockToken: POSTGRES_LEASE_LOCK, jobs: [InvoiceReminderJob], imports: [ ... ] }),
    JobsApiModule.forRoot({
      auditEmitterToken: MY_AUDIT_EMITTER,       // optional
      imports: [
        PostgresJobObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', cadences: { 'invoice-reminder': '1d' }, imports: [DatabaseModule] }),
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

`JobTrigger` is exported by `BackgroundJobsModule.forRoot()`; a job is triggerable
only if it's in that call's `jobs: [...]` list.

## Depends on

`background-jobs.core` (the port + `JobTrigger` + DTOs) and `authorization.core`
(guard, `@RequiresAction`, `CurrentActor`, `Actor`). Never a stack adapter.
