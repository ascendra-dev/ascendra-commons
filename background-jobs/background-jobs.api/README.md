# `background-jobs.api` — HTTP endpoints for a jobs admin screen

Opt-in NestJS controller over `JOB_OBSERVABILITY_PORT` (reads) and `JobTrigger`
(the one action). Stack-agnostic — wired to a stack adapter at the vertical via
`imports`. **No tenant scoping** — `background-jobs` has no `tenantId` anywhere.

## Endpoints

| Method | Path | Gate | → |
|---|---|---|---|
| GET | `/jobs` | `job.view` | `listJobStatus()` — one row per job: last run, last success, consecutive failures, cadence, `overdue` flag |
| GET | `/jobs/:name/runs` | `job.view` | `getRunHistory({ jobName, outcome?, since?, until?, limit?, cursor? })` — keyset-paginated, `error` truncated (~500 chars) |
| GET | `/jobs/runs/trace/:correlationId` | `job.view` | `getRunHistory({ correlationId })` — every run from one request/job chain |
| GET | `/jobs/runs/:id` | `job.view` | `getRun(id)` — one run, full untruncated `error`. 404 if not found |
| GET | `/jobs/:name/failed-items?minRuns=` | `job.view` | `getFailedItems(name, minRuns?)` — items recurring as a failed ref across at least `minRuns` (default 2) of the job's last 50 runs. Best-effort — see doc comment |
| GET | `/jobs/alerts` | `job.view` | `listJobStatus()` filtered to jobs that are `overdue` and/or have `consecutiveFailures >= 2` — read-only, no ack state, no webhook |
| POST | `/jobs/:name/run` | `job.run` | `JobTrigger.trigger(name, correlationId)` — "run now" / "retry". Returns `JobTriggerResult` (`unknown_job` / `already_running` / `completed` / `job_failed`) |

Gate names are fixed. A vertical whose catalog uses different names grants its
ops role these too.

## The trigger

`POST /jobs/:name/run` is the one mutating endpoint — a manual, privileged job
run. If the vertical binds `auditEmitterToken`, each trigger emits a
`{ action: 'job.triggered', actorId, jobName, result }` event (no-op if unbound;
no hard dep on `audit-logging`).

The correlation id that ends up on the run (and therefore in `getTrace()`) is
read from an inbound `X-Correlation-Id` header — the same header
`audit-logging`'s `CorrelationIdMiddleware` reads, reused by convention, not by
dependency: this module still has no import from `audit-logging`, but the two
naturally agree when both are wired in the same app. If the caller didn't send
one, the controller generates a fresh id via `crypto.randomUUID()` so every
manual run is still traceable.

`trigger()` awaits the whole run. For a long job, the vertical's own controller
can fire-and-forget instead; this endpoint always awaits (the advisory lock
still stops a double-click starting a second run).

## Truncated `error` on list rows

`getRunHistory()` and `listJobStatus()` truncate a run's `error` stack to
roughly 500 characters — shipping an unbounded stack trace on every row of a
list payload was an unintended info-leak risk, not just a size concern. The
full stack is always available via `GET /jobs/runs/:id`.

## Failed items — best-effort, not exact

`GET /jobs/:name/failed-items` groups `failedItemRefs` across a job's recent
runs to surface "chronic offenders." Matching relies entirely on the job's own
`describeItem()` returning something that identifies the same underlying item
run to run — `describeItem()` is documented as a logging aid, not a stable-id
contract, so a job whose ref embeds something that varies (an index, a
timestamp) will never show a recurrence here even if the same item keeps
failing. Not a dead-letter queue — per-item retry state is a Model 2 concern.

## Alerts — read-only listing only

`GET /jobs/alerts` is a pure filter over the existing `listJobStatus()` output
— no new persistence. Deliberately **not** built in this pass: an
acknowledge/ack-state, and any outbound webhook/notification delivery. Both
are real, separate pieces of work (see `mocks.html`'s Alerts & Overdue
section), not implied by this endpoint.

## What's deliberately not here

`GET /jobs/locks` (Lock Inspector) and `POST /jobs/:name/pause` (Pause /
Disable) are documented as proposed in `mocks.html` and intentionally not
implemented — see that file's coverage map for why.

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
