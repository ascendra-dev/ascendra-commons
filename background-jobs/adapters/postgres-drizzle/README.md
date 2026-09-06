# Background Jobs — Postgres/Drizzle adapter

For the common Ascendra stack — Postgres + Drizzle — a consuming project writes
**no persistence code**; it hands these its existing db connection and an
application name:

- `JobRunRecorder` — run-history observability (the `commons_jobs_job_run` table)
- `JobRunPrunerJob` — a reference retention job
- `PostgresJobStatusService` — read-only reporting for an admin UI: the
  run-history log and the jobs dashboard (with overdue detection)
- `PostgresLeaseLock` — a pool-safe `AdvisoryLock` (the `commons_jobs_lock`
  table), an alternative to the core's session-level `PostgresAdvisoryLock`

The `background-jobs/` core stays stack-agnostic — it ships the `JobRunRecorder`
and `AdvisoryLock` ports, never a database implementation beyond the
session-level lock. This folder is concrete implementations; a project on a
different stack ignores it and provides its own.

> The core's advisory lock (`SQL_EXECUTOR`) needs a **dedicated single
> connection** — see the module README. The recorder and pruner here have **no
> such requirement** and deliberately use the app's **normal pooled** db: run
> telemetry should not be serialized through the lock connection, and a
> recorder failure should not touch its health.

## What's in here

| File | What it is |
|---|---|
| `job-run.schema.ts` | Drizzle `pgTable` for `commons_jobs_job_run` — source of truth for the reference schema. `export` it from your schema barrel for `drizzle-kit generate`, and read your run-history admin screen through it (this adapter ships no read path). |
| `job-run.migration.sql` | The same table as hand-written DDL — paste into your migration tooling if you don't route through `drizzle-kit`. |
| `postgres-job-run-recorder.ts` | `PostgresJobRunRecorder` — one `INSERT`, `application` stamped on write, a failed write logged and swallowed (best-effort by contract). |
| `postgres-job-run-recorder.module.ts` | `PostgresJobRunRecorderModule.forRoot(...)` — binds the recorder to your db token, exports it as `POSTGRES_JOB_RUN_RECORDER`. |
| `job-run-pruner.job.ts` | `JobRunPrunerJob` — a reference `ScheduledJob` that deletes this application's `commons_jobs_job_run` rows past a retention window. The module dogfooding its own interface. |
| `job-run-pruner.module.ts` | `JobRunPrunerModule.forRoot(...)` — provides `JobRunPrunerJob` bound to your db, application, and `retentionDays` (default 90). |
| `job-status.service.ts` | `PostgresJobStatusService` — `getRunHistory()` (paginated log) + `listJobStatus()` (per-job dashboard with overdue detection). Read-only. |
| `job-status.module.ts` | `PostgresJobStatusModule.forRoot(...)` — binds the service to your db token, application, and optional `cadences`. |
| `cadence.ts` | Parses the `cadences` hints (`'1d'`, `'2h'`, seconds …). |
| `scheduler-lock.schema.ts` / `scheduler-lock.migration.sql` | The `commons_jobs_lock` table for `PostgresLeaseLock`. |
| `postgres-lease-lock.ts` | `PostgresLeaseLock` — a lease-row `AdvisoryLock`: conditional-upsert claim, heartbeat renewal, `DELETE` release. Pool-safe. |
| `postgres-lease-lock.module.ts` | `PostgresLeaseLockModule.forRoot(...)` — binds the lock to your db token, application, `leaseSeconds`; exports `POSTGRES_LEASE_LOCK`. |
| `sql-executor.ts` | The minimal db shape these need (`execute(sql)`), so the adapter never imports your generated schema. |

Two tables, each with three copies to keep in sync: `commons_jobs_job_run`
(`job-run.schema.ts` / `job-run.migration.sql` / the INSERT in
`postgres-job-run-recorder.ts`) and `commons_jobs_lock` (`scheduler-lock.schema.ts`
/ `scheduler-lock.migration.sql` / the statements in `postgres-lease-lock.ts`).

## Consuming it

### 1. Create the table

Either export the Drizzle table so `drizzle-kit` picks it up:

```typescript
// src/db/schema.ts  (your project)
export { jobRunTable } from 'src/ascendra-commons/background-jobs/adapters/postgres-drizzle';
```

…or copy `job-run.migration.sql` into your migrations directory. Both produce
the same `commons_jobs_job_run` table plus its index.

### 2. Wire the recorder

```typescript
import { BackgroundJobsModule } from 'src/ascendra-commons/background-jobs';
import {
  PostgresJobRunRecorderModule,
  POSTGRES_JOB_RUN_RECORDER,
} from 'src/ascendra-commons/background-jobs/adapters/postgres-drizzle';

BackgroundJobsModule.forRoot({
  sqlExecutorToken: SCHEDULER_DB,        // dedicated single connection — the advisory lock (see module README)
  imports: [
    SchedulerDbModule,
    PostgresJobRunRecorderModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION, // your app's NORMAL pooled Drizzle db
      application: 'ascendra-pay',           // stamped into every commons_jobs_job_run row's `application` column
      imports: [DatabaseModule],             // the module that exports DATABASE_CONNECTION
    }),
  ],
  jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,
})
```

Omit `jobRunRecorderToken` (and the `PostgresJobRunRecorderModule` import) and
recording is a no-op — the core binds `NoopJobRunRecorder`.

### 3. (optional) Schedule the pruner

`JobRunPrunerModule` only *provides* the job — it's inert until you give it a
cadence, exactly like any other `ScheduledJob`:

```typescript
import { IdempotentJobRunner } from 'src/ascendra-commons/background-jobs';
import { JobRunPrunerModule, JobRunPrunerJob } from 'src/ascendra-commons/background-jobs/adapters/postgres-drizzle';

@Module({
  imports: [
    JobRunPrunerModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      application: 'ascendra-pay',
      retentionDays: 90,
      imports: [DatabaseModule],
    }),
  ],
  providers: [JobRunPrunerSchedule],
})
export class JobRunPrunerWiringModule {}

@Injectable()
export class JobRunPrunerSchedule implements OnApplicationBootstrap {
  constructor(private readonly runner: IdempotentJobRunner, private readonly job: JobRunPrunerJob) {}
  async onApplicationBootstrap() { await this.runner.run(this.job, { trigger: 'bootstrap' }); }
  @Cron('30 3 * * *') async scheduledRun() { await this.runner.run(this.job); }
}
```

The pruner runs through the same `IdempotentJobRunner` as every other job — so
its own runs show up in `commons_jobs_job_run` too, under `job-run-pruner`. Add
`JobRunPrunerJob` to `BackgroundJobsModule.forRoot({ jobs: [...] })` (with
`JobRunPrunerModule` in `imports`) to also make it triggerable on demand via
`JobTrigger`.

### 4. (optional) Reporting for an admin UI — `PostgresJobStatusService`

```typescript
PostgresJobStatusModule.forRoot({
  sqlExecutorToken: DATABASE_CONNECTION,   // normal pooled db — reads only
  application: 'ascendra-pay',
  cadences: { 'invoice-reminder': '1d', 'session-cleanup': '1h' }, // optional; see below
  imports: [DatabaseModule],
})
```

Two methods, both `application`-scoped, both read-only:

- **`getRunHistory({ jobName?, outcome?, since?, until?, limit?, cursor? })`** —
  the drill-down log. Newest first, keyset-paginated: a result with `nextCursor`
  has more; pass it back as `cursor`. `limit` defaults to 50, capped at 200.
- **`listJobStatus()`** — the dashboard, one `JobStatus` per job: `lastRun`,
  `lastSuccessAt`, `consecutiveFailures` (leading `job_failed` **or**
  `itemsFailed > 0` runs), `cadence`, `overdue`, `overdueBy`. Covers every job
  that has ever run, plus every job named in `cadences`.

The controller is yours (~3 lines), gated with your own `Authorizer`:

```typescript
@Get('admin/jobs')                 @Get('admin/jobs/:name/runs')
list() { return this.status.listJobStatus(); }
runs(@Param('name') n, @Query() q) { return this.status.getRunHistory({ jobName: n, ...q }); }
```

**How `overdue` works without the real cron.** The adapter never sees `@Cron`.
`cadences` is a *separate*, hand-typed hint — a rough "if it hasn't run in this
long, something's wrong" bound (`'1d'` / `'2h'` / `'30m'` / `'90s'` / seconds).
Keep it loosely in step with the job's `@Cron` (daily → `'1d'`); if it drifts
the badge is just mis-tuned, never the job. `listJobStatus()` returns the hint
back (`cadence.label`, `cadence.source: 'declared'`) so the UI shows "last run
3 days ago / expected every 1 day" side by side — the human doesn't need the
schedule memorised. A job is `overdue` once the gap since its last run exceeds
its cadence by 1.5× (a daily job flags after ~36h), or a `cadences`-listed job
has never run.

**Inference, so `cadences` is optional.** For a job with no `cadences` entry,
the service infers a cadence from the median gap between that job's recent
`trigger: 'scheduled'` non-failed runs (needs ≥ 3), returned as
`cadence.source: 'inferred'` — show it more softly in the UI. Too few runs and
no hint → `cadence: null`, no `overdue` verdict, history only.

What it deliberately does **not** do: enumerate each individual missed fire
("missed 08:00 Mon, 08:00 Tue …"). That needs a cron-expression engine and
synthesises rows that were never recorded; "overdue by 3 days, expected every
1 day" is the actionable form and is what the dashboard shows.

### 5. (optional) Pool-safe locking — `PostgresLeaseLock`

The core's default `PostgresAdvisoryLock` uses a **session-level**
`pg_advisory_lock`, which only works if `SQL_EXECUTOR` is a dedicated single
connection and is unsupported through a transaction-mode pooler (see the module
README). `PostgresLeaseLock` replaces it with a `commons_jobs_lock` **row**:

- **Create the table** — `export { schedulerLockTable }` for `drizzle-kit`, or
  paste `scheduler-lock.migration.sql`.
- **Wire it** as the lock:

```typescript
BackgroundJobsModule.forRoot({
  advisoryLockToken: POSTGRES_LEASE_LOCK,   // replaces PostgresAdvisoryLock; no sqlExecutorToken needed
  imports: [
    PostgresLeaseLockModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION, // the NORMAL pooled db — no affinity requirement
      application: 'ascendra-pay',
      leaseSeconds: 900,                     // default; see below
      imports: [DatabaseModule],
    }),
  ],
})
```

How it behaves:

- **Claim** is a conditional upsert — `INSERT … ON CONFLICT DO UPDATE …
  WHERE locked_until < now()`. Take-over only when the previous lease has
  expired; Postgres re-checks the `WHERE` against the row-locked tuple, so two
  instances racing an expired lock never both win.
- **`leaseSeconds`** (default 900 / 15 min, min 3) is how long a crashed
  holder's lock stays stuck before the next run can reclaim it. Set it
  comfortably above a job's worst-case run time — **too short risks two
  instances overlapping**, too long only slows crash recovery.
- **Heartbeat** — while a run holds the lock, the lease is renewed every
  `leaseSeconds / 3`, so a run legitimately longer than one lease keeps going.
  If a heartbeat ever finds the row gone (the lease lapsed and another instance
  took over), it logs a `WARN` — raise `leaseSeconds`.
- **`holder`** is `hostname#pid#uuid` per process; release and heartbeat only
  ever touch this process's own row. `SELECT * FROM commons_jobs_lock` shows
  what's held right now.
- Timers are `unref`'d and cleared on `onModuleDestroy`.

## Notes

- **`application` is on every row of both tables and every read filters by
  it.** Constant within one app's own database (one value); the column keeps
  `commons_jobs_job_run` and `commons_jobs_lock` correct if ever consolidated into one shared
  operational database. Same `MODULE-STANDARD.md` dimension-4 call
  `notification` and `audit-logging` make. `JobRunPrunerJob`'s DELETE and every
  `PostgresLeaseLock` statement are `application`-scoped for the same reason —
  they never touch another app's rows.
- **`commons_jobs_lock` doesn't need pruning** — it's at most one row per job,
  reused in place. A stale row from a crashed holder is harmless (the next
  claim overwrites it once the lease expires).
- **Reads: `PostgresJobStatusService` or your own query.** The service covers
  the common UI shapes (history log + dashboard); for anything else, query
  `commons_jobs_job_run` directly through the re-exported `jobRunTable` with your own
  Drizzle client. `PostgresJobRunRecorder` only writes.
- **`application` is a plain string, not `domain-events`'
  `DOMAIN_EVENTS_APPLICATION_ID` token** — pass the same value, supplied here
  as a value so the adapter works whether or not that token is bound.
- **Retention is yours to run.** `commons_jobs_job_run` is one row per job per run — a
  daily job is ~365 rows/year (trivial); a per-minute job is ~525k/year (still
  small, but prune it). `JobRunPrunerModule` is the ready-made way; a plain
  `DELETE FROM commons_jobs_job_run WHERE application = $1 AND started_at < now() - interval '90 days'`
  on any schedule is equivalent.
- **Missed-schedule detection is `listJobStatus()`'s `overdue`** — driven by
  the hand-supplied `cadences` hint (or an inferred one), not by reading
  `@Cron`. There is no watchdog process; the UI (or an alert querying the same
  data) decides what to do with an `overdue: true` row.
