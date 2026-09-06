# Background Jobs Pattern

Something needs to run on a schedule, safely, exactly once per due item — no
duplicate execution across a rolling deploy's window, no lost fire, no single
item's failure stalling the batch. `ScheduledJob<TItem>` and
`IdempotentJobRunner` carry no knowledge of any particular use case.

Like `audit-logging` there is **no Model 1 / Model 2 config split** — "Model 2"
is a real job queue (pg-boss etc.) behind the same `ScheduledJob` interface,
only `IdempotentJobRunner`'s internals swap. So the split is only along the
delivery seams.

## The packages

| Package | Role | Depends on |
|---|---|---|
| **`background-jobs.core`** | `ScheduledJob` / `AdvisoryLock` / `JobRunRecorder` / `JobObservabilityPort` ports, `IdempotentJobRunner`, `ScheduledJobRegistry` + `JobTrigger`, `NoopJobRunRecorder`, the stack-agnostic helpers (`parseCadence`, `encodeKeysetCursor`) + observability DTOs, `BackgroundJobsModule.forRoot()`. **No lock implementation.** | `@nestjs/common` |
| **`background-jobs.core.postgres-drizzle`** | `lock/` (`PostgresAdvisoryLock` **and** `PostgresLeaseLock` — pick one), `run-recorder/` (`PostgresJobRunRecorder`), `observability/` (implements `JobObservabilityPort`), `pruner/` (`JobRunPrunerJob`). Schemas + migrations. | `background-jobs.core` |
| **`background-jobs.api`** | Opt-in HTTP: jobs dashboard, run history, cross-module trace, and a `POST /jobs/:name/run` trigger. | `background-jobs.core`, `authorization.core` |

No "family" package — both ports and all DTOs are stack-agnostic `.core`
contracts (`PostgresAdvisoryLock` moved *out* of `.core` in the split — it's
`pg_try_advisory_lock`-specific).

## Pick a lock — `forRoot({ advisoryLockToken })` is required

| | `PostgresAdvisoryLock` (`POSTGRES_ADVISORY_LOCK`) | `PostgresLeaseLock` (`POSTGRES_LEASE_LOCK`) |
|---|---|---|
| Mechanism | `pg_try_advisory_lock` (session-level) | a `commons_jobs_lock` row + lease |
| Extra DB objects | none | one table + migration |
| Connection | **dedicated single connection**, never a transaction-mode pooler | any pooled connection, any pooler |
| Crash frees it | connection closes | lease expires (`leaseSeconds`, default 900) |

## Wiring

```typescript
BackgroundJobsModule.forRoot({
  advisoryLockToken: POSTGRES_LEASE_LOCK,        // required — pick a lock
  jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER, // optional — run-history recording
  jobs: [InvoiceReminderJob],                     // optional — triggerable by name
  imports: [
    PostgresLeaseLockModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    PostgresJobRunRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    InvoiceModule,
  ],
})
```

Each job supplies its own `@Cron` / `OnApplicationBootstrap` wiring class around
`IdempotentJobRunner` — this module ships no scheduler. You also need
`@nestjs/schedule` + `ScheduleModule.forRoot()`.

## The pieces (in `background-jobs.core`)

- **`ScheduledJob<TItem>`** — `name` (unique, becomes the lock key),
  `findDueItems()`, `processItem()` (must be safe to never re-run once resolved
  *and* safe to retry — build a per-item "done" marker last), optional
  `describeItem()`.
- **`IdempotentJobRunner`** — acquire the lock → iterate due items with per-item
  failure isolation → release → record a `JobRunSummary`. A lock-not-acquired
  return is *not* a run.
- **`JobRunRecorder`** — best-effort run telemetry, **must not throw** (opposite
  posture to `audit-logging`). No-op by default.
- **`JobTrigger`** — resolve a job by name → run it out of schedule. The hook
  behind a "run now" / "retry" button (`background-jobs.api` serves it).
- **`JobObservabilityPort`** — `getRunHistory` (drill-down) + `listJobStatus`
  (dashboard, with derived `overdue` detection from a cadence hint).

## `applicationId` / `tenantId`

Neither in `.core` — a run never leaves its process. The Postgres adapter's
`commons_jobs_*` tables carry `application` (dimension 4). Per-item tenancy lives
entirely inside a job's own `findDueItems()` / `processItem()` — `background-jobs.api`
has no tenant scoping as a result.

## What's not built

- No queue, backoff, or dead-letter path — a permanently-failing item retries
  every run forever (visible in `failedItemRefs`, but nothing stops it). That's
  the Model 2 trigger.
- No admin **UI** — `background-jobs.api` ships the endpoints; the frontend is
  `ascendra-commons-ui`.
