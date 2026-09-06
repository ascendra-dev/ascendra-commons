# Background Jobs Pattern

## Overview

Something needs to run on a schedule, safely, exactly once per due item — no
duplicate execution across a rolling deploy's brief multi-instance window, no
silently-lost fire if every instance was down at the scheduled time, and no
single item's failure stalling the rest of a batch or a future run. This
module defines that mechanism generically: `ScheduledJob<TItem>` and
`IdempotentJobRunner` carry no knowledge of any particular use case — what
"due" means and what "processed" does are entirely the implementer's concern,
the same separation `Authorizer` keeps from any one action name, or
`NotificationSender` keeps from any one `eventType`.

The motivating case was invoice payment reminders (a project's brief promising
automatic follow-up on overdue amounts), but that's one consumer of this
pattern, not what the pattern is about — see the worked example below.

Built and audited against `MODULE-STANDARD.md` (this repo's root). `tenantId`
appears nowhere: `IdempotentJobRunner`/`AdvisoryLock` never see an individual
item's tenant — tenancy, if relevant, lives entirely inside the
project-supplied `ScheduledJob.findDueItems()`/`processItem()` (see the worked
example's own `withTenantContext` calls). `applicationId` appears nowhere in
the **core** — a run never leaves the process it happens in — but the
`adapters/postgres-drizzle` run-history table carries an `application` column
and every read filters by it, the same dimension-4 call `notification` and
`audit-logging` make: `job_run` is the one surface where multiple Ascendra
apps' output could plausibly land in one shared operational database, so the
column is carried now to avoid a later backfill.

## The pieces

### `ScheduledJob<TItem>` — defined once, never a specific job's logic

```typescript
export interface ScheduledJob<TItem> {
  readonly name: string;                    // unique across every job — becomes the advisory lock key
  findDueItems(): Promise<TItem[]>;
  processItem(item: TItem): Promise<void>;
  describeItem?(item: TItem): string;       // optional, log-safe id — names the item in a per-item failure log
}
```

`name` must be unique across every job in the application — it becomes the
advisory lock key (`scheduler:{name}`). Keep job names in one const catalog —
the same *reason* `Actions` is one const catalog in the authorization pattern
(a typo becomes a compile error, not a silently uncoordinated second lock),
though not the same string shape: a job name isn't a resource+verb pair the
way an action is, so it doesn't follow the `resource.verb` convention (a job
name is conventionally kebab-case, e.g. `'invoice-reminder'`, as in the worked
example below).

`processItem` must be safe to never run again for an item once it resolves,
and safe to be retried for an item that never got this far. The standard way
to build that: do the side effect, then persist a per-item "done" marker
*last* — a crash before that marker commits leaves the item correctly due
again on the next run, never silently skipped and never silently duplicated
by construction of the runner (see `IdempotentJobRunner`, below), not by any
retry logic `processItem` has to implement itself.

"Never silently duplicated" is exactly as strong as the boundary between the
side effect and the marker write. If the two are in *separate* transactions
(the worked example's `emitCritical()` then `markRemindedToday()` are), a
failure in the window between them re-runs the whole of `processItem` next
run — so the side effect must itself be idempotent (thread an
[`idempotency-key`](../idempotency-key) through the event, or make the
downstream consumer dedupe), or the marker write must share one transaction
with an outbox row that the side effect is driven from. This pattern doesn't
choose for you; it does require you to have chosen. See the worked example's
note.

`describeItem` is optional and used only for logging: when `processItem`
throws, the runner logs *which* item failed. Return a bare id or reference,
never PII or the whole row. Omit it and the runner logs the item's batch
position instead.

### `AdvisoryLock` / `PostgresAdvisoryLock` (Model 1) — the lock, swappable

```typescript
export interface AdvisoryLock {
  tryAcquire(key: string): Promise<boolean>; // non-blocking — false if another instance already holds it
  release(key: string): Promise<void>;
}
```

`PostgresAdvisoryLock` implements this over `pg_try_advisory_lock` /
`pg_advisory_unlock`, keyed via `hashtext()` so callers never manage numeric
lock ids. The guarantee is enforced by Postgres itself, not in-process
coordination that only one instance can see — the same reasoning as RLS for
tenancy and an atomic claim for idempotency keys elsewhere in this stack.
Session-scoped advisory locks release automatically when the holding
connection closes, so a crashed process never leaves one stuck.

**Connection-affinity requirement.** A session-level advisory lock belongs to
one physical connection. `tryAcquire()` and `release()` must run on the *same*
session — otherwise the unlock is a no-op on a connection that never held the
lock, the acquiring connection keeps the lock until it is idle-closed, and the
job silently skips every run in between. Through a **transaction-mode pooler**
(PgBouncer, Supabase "Transaction pooler") session-level advisory locks are
unsupported outright. So the provider wired to `SQL_EXECUTOR` must be a
**dedicated single connection**, distinct from the app's request-serving pool
— `drizzle(new Pool({ max: 1, idleTimeoutMillis: 0 }))` — pointed at a direct
connection or a session-mode pooler, never a transaction pooler. As a canary,
`release()` logs a `WARN` whenever `pg_advisory_unlock` reports the lock
wasn't held — if that line ever appears, `SQL_EXECUTOR` is misconfigured.

This is Model 1's accepted sharp edge, mitigated by wiring + detection rather
than removed. The lease-table approach that removes it entirely (pool-agnostic,
self-recovering) is a real Model 1 extension — deferred, along with the one
small table it needs, until job-run observability is built (they share that
table). Until then: dedicated connection, and watch for the WARN.

It depends on `SqlExecutor` — deliberately the *minimal* shape needed
(`execute(query): Promise<{ rows }>`), not a consumer's full schema-typed
Drizzle client, so this library never depends on any project's generated
schema. `AdvisoryLock` is kept separate from `IdempotentJobRunner` specifically
so the runner's own logic (iteration, failure isolation) is unit-testable
against a fake lock — only `PostgresAdvisoryLock`'s own spec needs anything
resembling a database shape.

### `IdempotentJobRunner` — the safety mechanism, implemented once

```typescript
async run(job: ScheduledJob<unknown>, options?: { trigger?: JobRunTrigger }): Promise<void> {
  const lockKey = `scheduler:${job.name}`;
  if (!(await this.lock.tryAcquire(lockKey))) return; // not a run — not recorded
  // ...capture startedAt + item counters...
  try {
    const due = await job.findDueItems();
    for (let i = 0; i < due.length; i++) {
      try {
        await job.processItem(due[i]);          // itemsProcessed++
      } catch (err) {
        // itemsFailed++, failedItemRefs.push(describe(...)) capped at 50
        this.logger.error(`Scheduled job "${job.name}" failed on ${this.describe(...)} …`, err.stack);
      }
    }
  } catch (err) {
    outcome = 'job_failed'; jobError = err.stack;  // findDueItems() threw
    throw err;
  } finally {
    // guarded: a failure to *unlock* must never replace the primary error from the try block
    await this.lock.release(lockKey).catch((err) => this.logger.error(/* ... */));
    // best-effort: a failure to *record* must never mask or compound the real outcome
    await this.record({ jobName: job.name, trigger: options?.trigger ?? 'scheduled', outcome, ... });
  }
}
```

Per-item try/catch is a property of the mechanism, not any one job — a bad
item never stalls the rest of that run, and never stalls a different job
sharing the same process. If `findDueItems()` itself throws (a job-level
failure, distinct from a single item's), the lock is still released in
`finally`, but the error propagates out of `run()` — the caller finds out the
whole job failed to even query, rather than that being silently swallowed.
The `release()` in `finally` is `.catch`-guarded for exactly that reason: an
unguarded rejecting `await` in a `finally` replaces whatever the `try` block
was throwing, so a transient unlock failure would otherwise mask the real
job-level error. A failed release is logged, never rethrown — and the run
recording that follows it is guarded the same way, for the same reason (see
"Job-run observability" below).

### Scheduling composition — left to each job, not owned by the runner

`IdempotentJobRunner` has no `@Cron`, no `OnApplicationBootstrap`, and no
opinion on cadence — different jobs may need different schedules. Each job
gets its own thin wiring class:

```typescript
@Injectable()
export class SomeJobSchedule implements OnApplicationBootstrap {
  constructor(private readonly runner: IdempotentJobRunner, private readonly job: SomeJob) {}

  async onApplicationBootstrap() {
    // catches up if the scheduled fire below was missed; trigger tags the run in the history
    await this.runner.run(this.job, { trigger: 'bootstrap' });
  }

  @Cron('0 8 * * *') // this job's own cadence — not shared with any other job
  async scheduledRun() {
    await this.runner.run(this.job); // trigger defaults to 'scheduled'
  }
}
```

A genuine alternative was considered and set aside, not overlooked: `@nestjs/schedule` also exposes a *dynamic* registration API (`SchedulerRegistry.addCronJob()`), which would let `ScheduledJob` carry its own `cronExpression` as data, with one generic loader auto-registering every job at `OnModuleInit` — zero per-job wiring classes at all. Not built for Model 1: `@Cron()` still needs an actual decorated method to attach to somewhere, so putting the cadence on the job wouldn't remove a wiring class, only relocate the string into it; the static decorator is also the more idiomatic NestJS shape and needs no library-side scheduling machinery. Worth revisiting if the number of jobs (and per-job wiring boilerplate) grows enough to make the tradeoff worthwhile.

## Model 1 — In-Process Loop, Postgres Advisory Lock (current)

What's shipped in this folder: `ScheduledJob<TItem>`, `AdvisoryLock`,
`PostgresAdvisoryLock`, `IdempotentJobRunner`, the `JobRunRecorder` port +
`NoopJobRunRecorder`, `ScheduledJobRegistry` + `JobTrigger` (admin-initiated
out-of-schedule runs), and `BackgroundJobsModule.forRoot()`. Plus
`adapters/postgres-drizzle/` — a ready-made `PostgresJobRunRecorder` (+ its
`job_run` table) and a reference `JobRunPrunerJob`. No queue, no backoff
policy, no dead-letter path, no scheduling built in — each job supplies its
own `@Cron`/`OnApplicationBootstrap` wiring around the shared runner.

Accepted limitations, each covered above where it's relevant:

- **`SQL_EXECUTOR` must be a dedicated single connection** (never a
  transaction-mode pooler) — the session-level lock's connection-affinity
  requirement. Mitigated by wiring + a `release()` WARN canary, not removed.
- **`findDueItems()` returns the whole due set** into memory and items are
  processed **serially** — a job that falls far behind, or one with a large
  due-set and per-item latency, holds the lock for the full batch. A job can
  self-limit its batch, but then catch-up rate is bounded by cadence.
- **A permanently-failing item retries every run forever** — no attempt
  counter, no dead-letter. It's logged each run, and (with a recorder wired)
  shows up in each run's `failedItemRefs`, so "same item failing every run" is
  at least visible — but nothing *stops* it. This is the Model 2 trigger.
- **`hashtext()` is a 32-bit hash** — two distinct job names could in
  principle collide onto one lock. Keep names in one catalog; a handful of
  jobs makes this negligible.
- **`onApplicationBootstrap` runs the job on every pod at every deploy** (the
  lock means only one executes) — not just after a genuine missed fire.

### Job-run observability

`IdempotentJobRunner` assembles one `JobRunSummary` per execution that
acquired the lock and hands it to a `JobRunRecorder`:

```typescript
type JobRunTrigger = 'scheduled' | 'bootstrap' | 'manual';
type JobRunOutcome = 'completed' | 'job_failed'; // job_failed = findDueItems() itself threw

interface JobRunSummary {
  jobName: string;
  trigger: JobRunTrigger;
  startedAt: Date;
  finishedAt: Date;
  outcome: JobRunOutcome;
  itemsDue: number;       // 0 on a job_failed run
  itemsProcessed: number;
  itemsFailed: number;
  failedItemRefs: string[]; // describeItem() output for failed items, capped at 50
  error?: string;          // job-level stack, only when outcome === 'job_failed'
}

interface JobRunRecorder {
  recordRun(summary: JobRunSummary): Promise<void>; // best-effort — must never throw
}
```

What it answers:

- **Did it work?** `outcome` (`job_failed` = `findDueItems()` threw, nothing
  processed) plus `itemsFailed` (a run where some `processItem()` calls threw
  is still `completed`, with those items left due).
- **What's stuck?** `failedItemRefs` — "invoice a1b2 failed the last 6 runs"
  becomes a query. Capped; it's a diagnosis sample, not a dead-letter queue
  (per-item retry policy is Model 2).
- **Did it run at all / missed schedule?** *Derived*, not recorded — you
  cannot write a row for a run that never happened. The Postgres adapter's
  `PostgresJobStatusService.listJobStatus()` computes an `overdue` flag per job
  from a hand-supplied (or history-inferred) cadence hint — see that folder's
  README. `trigger` sharpens it: a spike of `bootstrap` runs processing large
  batches means scheduled fires were being missed and the
  `OnApplicationBootstrap` catch-up compensated.

Design constraints, each deliberate:

- **Best-effort, the opposite of `audit-logging`.** An audit write is critical
  (a failure should roll the triggering operation back). A run record must
  never mask or compound a real job failure — so `JobRunRecorder` implementations
  must not throw, *and* `IdempotentJobRunner` guards the call anyway.
- **A lock-not-acquired return is not a run** and is never recorded — a rolling
  deploy's overlap window makes that frequent, uninteresting noise.
- **The runner owns no persistence.** `NoopJobRunRecorder` is the default;
  `BackgroundJobsModule.forRoot({ jobRunRecorderToken })` swaps in a real one.
  `adapters/postgres-drizzle/` ships `PostgresJobRunRecorder` and its `job_run`
  table, plus `PostgresJobStatusService` for reading it back (history log +
  jobs dashboard) — see that folder's README. A different stack provides its
  own `JobRunRecorder` against the same port.

### Triggering a job out of schedule — `JobTrigger`

The natural companion to a run-history admin screen: a "run now" / "retry"
button. `IdempotentJobRunner.run()` already accepts `{ trigger: 'manual' }`;
what's missing for an HTTP controller is resolving a job **name** (what the UI
sends) to the job **instance**. That's `ScheduledJobRegistry` +
`JobTrigger`, both provided by `forRoot()`:

```typescript
BackgroundJobsModule.forRoot({
  sqlExecutorToken: SCHEDULER_DB,
  imports: [SchedulerDbModule, InvoiceModule /* exports InvoiceReminderJob */],
  jobs: [InvoiceReminderJob, JobRunPrunerJob], // the jobs an admin may trigger by name
})
```

```typescript
@Post('admin/jobs/:name/run')          // gate with your own Authorizer — a manual run is privileged
run(@Param('name') name: string) {
  return this.jobTrigger.trigger(name); // JobTrigger is exported by BackgroundJobsModule
}
```

`trigger(name)` returns a discriminated result: `unknown_job` /
`already_running` (the lock was held — a scheduled fire or another click is
mid-run) / `completed` with `{ itemsDue, itemsProcessed, itemsFailed, failedItemRefs }`
/ `job_failed` with the error. The run is recorded with `trigger: 'manual'`.

What it is and isn't:

- **"Retry" and "run now" are the same call.** `run()` re-queries
  `findDueItems()`, so a **level-triggered** job (the shape this module asks
  for) picks up the items that failed last run automatically. A job whose
  `findDueItems()` is edge-triggered won't — that's a job bug, not a trigger
  limitation.
- **Not per-item retry.** `failedItemRefs` are opaque `describeItem()` strings;
  the runner can't turn one back into an item and process it alone. Per-item
  retry state is Model 2.
- **`trigger()` awaits the whole run.** For a job that can run long, the
  controller should fire-and-forget and return `202` — `void this.jobTrigger.trigger(name)`
  — then let the admin screen poll the run history. The lock still stops a
  double-click starting a second run.
- **A job left out of `jobs: [...]` still runs on its `@Cron`** — it just
  can't be triggered on demand. Two jobs with the same `name` in the list is a
  startup error (the name is also the lock key).

## Model 2 — Dedicated Job Queue (future target)

A proper job queue (e.g. `pg-boss`, staying Postgres-backed rather than
introducing Redis) with backoff, a dead-letter path, and observability — once
job *volume* or *variety* genuinely outgrows what an in-process loop can
express. Same `ScheduledJob<TItem>` interface every Model 1 consumer already
implements — only `IdempotentJobRunner`'s internals swap, from an in-process
loop to enqueue-per-item with the queue's own retry/backoff policy. No
consumer changes at all, the same seam `Authorizer` and `NotificationSender`
protect in their own patterns. Build only once several distinct scheduled
concerns exist and genuinely need independent scheduling, retry policy, or
failure isolation beyond what per-item try/catch already provides.

## Consuming this module

Copy `background-jobs/` into the consumer's `src/ascendra-commons/background-jobs/`
(see `module-packaging-pattern.md` for why vendored patterns land under one
wrapper folder), then wire `SQL_EXECUTOR` to a **dedicated single connection**,
not the app's request-serving pool (see the connection-affinity requirement
above):

```typescript
export const SCHEDULER_DB = Symbol('SCHEDULER_DB');

@Module({
  providers: [
    {
      provide: SCHEDULER_DB,
      // One connection, never idle-closed, never a transaction-mode pooler.
      useFactory: (config: ConfigService) =>
        drizzle(new Pool({ connectionString: config.getOrThrow('DATABASE_URL'), max: 1, idleTimeoutMillis: 0 })),
      inject: [ConfigService],
    },
  ],
  exports: [SCHEDULER_DB],
})
export class SchedulerDbModule {}

@Module({
  imports: [
    BackgroundJobsModule.forRoot({
      sqlExecutorToken: SCHEDULER_DB,   // the dedicated connection above — NOT the app's DATABASE_CONNECTION pool
      imports: [
        SchedulerDbModule,             // exports SCHEDULER_DB — useExisting can't see it otherwise
        InvoiceModule,                 // must `exports: [InvoiceReminderJob]` for `jobs` below to resolve
        // optional — run-history recording; omit for no-op. Uses the app's NORMAL pooled db, not SCHEDULER_DB.
        PostgresJobRunRecorderModule.forRoot({
          sqlExecutorToken: DRIZZLE,
          application: 'ascendra-pay',
          imports: [],                 // DRIZZLE is @Global in pay-api
        }),
      ],
      jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER, // omit → NoopJobRunRecorder
      jobs: [InvoiceReminderJob],      // optional — jobs an admin can trigger by name via JobTrigger
    }),
    // optional — keeps job_run pruned; give JobRunPrunerJob a cadence with a schedule class
    JobRunPrunerModule.forRoot({ sqlExecutorToken: DRIZZLE, application: 'ascendra-pay', retentionDays: 90 }),
  ],
})
export class AppModule {}
```

Each job's own `findDueItems()` / `processItem()` still use the app's normal
pooled `db` — only the advisory lock needs the dedicated connection. The
run recorder and pruner also use the normal pooled `db` (see
`adapters/postgres-drizzle/README.md`).

`imports` is required unless the module providing `sqlExecutorToken` is itself
marked `global: true` — `useExisting` only resolves a token NestJS can already
see in `BackgroundJobsModule`'s own providers or imports, not anywhere in the
wider application graph, so the connection's module has to be named here
explicitly.

You also need `@nestjs/schedule` (`npm i @nestjs/schedule`) and
`ScheduleModule.forRoot()` in `AppModule` — this module ships no scheduler, so
the per-job `@Cron` / `OnApplicationBootstrap` wiring below depends on it.
Note `@nestjs/schedule` does not prevent a `@Cron` handler from being
re-entered while a previous run is still in flight — overlap protection is
*only* the advisory lock.

### Worked example: invoice payment reminders

Shown to demonstrate the seam — nothing in `ScheduledJob`/`IdempotentJobRunner`
knows this exists.

```typescript
@Injectable()
export class InvoiceReminderJob implements ScheduledJob<Invoice> {
  readonly name = 'invoice-reminder';

  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly events: DomainEventEmitter, // never raw EventEmitter2 — see the domain-events pattern
    private readonly db: DrizzleDb,
  ) {}

  // A background job has no authenticated actor and no HTTP request — a request-scoped
  // TenantContext (multi-tenancy pattern) cannot be constructed here. Call the consumer's
  // own lower-level admin-scope helper directly instead, the same branch ascendra_admin's
  // RLS policy already grants, not a new bypass mechanism.
  findDueItems() {
    return withTenantContext(this.db, { kind: 'admin' }, (tx) =>
      this.invoiceRepo.findOverdueNotYetRemindedToday(tx));
  }

  describeItem(invoice: Invoice) {
    return `invoice ${invoice.id}`; // log-safe id only — surfaces in the runner's per-item failure log
  }

  async processItem(invoice: Invoice) {
    // emitCritical(), not emit() — if this event also drives an audit-log listener, that
    // listener's failures must never be silently dropped (see the domain-events pattern's
    // tiering rule); a notification listener on the same event can still individually stay
    // best-effort via a plain @OnEvent() regardless of which emit method the publisher uses.
    //
    // reminderKey makes the reminder itself idempotent downstream — see the note below on
    // why this matters given emit and marker are separate transactions.
    const reminderKey = `invoice-reminder:${invoice.id}:${today()}`;
    await this.events.emitCritical('invoice.reminder_due', new PaymentReminderDue(invoice.id, reminderKey));

    // Only reached once the line above genuinely resolves — DomainEventEmitter awaits
    // emitAsync() internally, unlike raw EventEmitter2.emit(), which returns before an
    // async listener has even started. That's what makes "mark immediately after
    // processing" a real guarantee instead of a race.
    await withTenantContext(this.db, { kind: 'admin' }, (tx) =>
      this.invoiceRepo.markRemindedToday(tx, invoice.id));
  }
}
```

**The emit and the marker are two separate transactions**, so `processItem`
is at-least-once, not exactly-once: if `emitCritical()` resolves (the
reminder is on its way) and then `markRemindedToday()` fails, the invoice is
still `findDueItems`-eligible next run and the reminder goes out again. Two
ways to close that, and this pattern requires you to pick one — it doesn't
pick for you:

- **Downstream dedupe (shown above).** The event carries a deterministic
  `reminderKey`; the notification consumer claims it through
  [`idempotency-key`](../idempotency-key) and a replay is a no-op. Simplest
  when the side effect already flows through a consumer that can dedupe.
- **Transactional outbox.** Write the marker *and* an outbox row in one
  `withTenantContext` transaction, and drive the emit from a separate
  outbox-drain job. Nothing escapes without the marker; nothing is marked
  without something to emit.

Skipping both means "customer receives two reminder emails" is a live
outcome on any failure between the two writes.

A per-item "done" marker like `last_reminded_on` can only express "at most
once per period." A tapering or capped cadence needs a count/stage column
instead — that's a business-rule decision for the consuming project to make,
not something this pattern has an opinion on.
