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

Built and audited against `MODULE-STANDARD.md` (this repo's root). Neither
`applicationId` nor `tenantId` appears anywhere in this module, both
deliberately: a run never leaves the process it happens in (no `applicationId`
use case), and `IdempotentJobRunner`/`AdvisoryLock` never see an individual
item's tenant at all — tenancy, if relevant, lives entirely inside the
project-supplied `ScheduledJob.findDueItems()`/`processItem()` (see the worked
example's own `withTenantContext` calls). There's nothing tenant-shaped for
this module's own logic to take a parameter for.

## The pieces

### `ScheduledJob<TItem>` — defined once, never a specific job's logic

```typescript
export interface ScheduledJob<TItem> {
  readonly name: string;                    // unique across every job — becomes the advisory lock key
  findDueItems(): Promise<TItem[]>;
  processItem(item: TItem): Promise<void>;
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

It depends on `SqlExecutor` — deliberately the *minimal* shape needed
(`execute(query): Promise<{ rows }>`), not a consumer's full schema-typed
Drizzle client, so this library never depends on any project's generated
schema. `AdvisoryLock` is kept separate from `IdempotentJobRunner` specifically
so the runner's own logic (iteration, failure isolation) is unit-testable
against a fake lock — only `PostgresAdvisoryLock`'s own spec needs anything
resembling a database shape.

### `IdempotentJobRunner` — the safety mechanism, implemented once

```typescript
async run(job: ScheduledJob<unknown>): Promise<void> {
  const lockKey = `scheduler:${job.name}`;
  if (!(await this.lock.tryAcquire(lockKey))) return;
  try {
    const due = await job.findDueItems();
    for (const item of due) {
      try {
        await job.processItem(item);
      } catch (err) {
        this.logger.error(`Scheduled job "${job.name}" failed on one item`, err as Error);
      }
    }
  } finally {
    await this.lock.release(lockKey);
  }
}
```

Per-item try/catch is a property of the mechanism, not any one job — a bad
item never stalls the rest of that run, and never stalls a different job
sharing the same process. If `findDueItems()` itself throws (a job-level
failure, distinct from a single item's), the lock is still released in
`finally`, but the error propagates out of `run()` — the caller finds out the
whole job failed to even query, rather than that being silently swallowed.

### Scheduling composition — left to each job, not owned by the runner

`IdempotentJobRunner` has no `@Cron`, no `OnApplicationBootstrap`, and no
opinion on cadence — different jobs may need different schedules. Each job
gets its own thin wiring class:

```typescript
@Injectable()
export class SomeJobSchedule implements OnApplicationBootstrap {
  constructor(private readonly runner: IdempotentJobRunner, private readonly job: SomeJob) {}

  async onApplicationBootstrap() {
    await this.runner.run(this.job); // catches up if the scheduled fire below was missed
  }

  @Cron('0 8 * * *') // this job's own cadence — not shared with any other job
  async scheduledRun() {
    await this.runner.run(this.job);
  }
}
```

A genuine alternative was considered and set aside, not overlooked: `@nestjs/schedule` also exposes a *dynamic* registration API (`SchedulerRegistry.addCronJob()`), which would let `ScheduledJob` carry its own `cronExpression` as data, with one generic loader auto-registering every job at `OnModuleInit` — zero per-job wiring classes at all. Not built for Model 1: `@Cron()` still needs an actual decorated method to attach to somewhere, so putting the cadence on the job wouldn't remove a wiring class, only relocate the string into it; the static decorator is also the more idiomatic NestJS shape and needs no library-side scheduling machinery. Worth revisiting if the number of jobs (and per-job wiring boilerplate) grows enough to make the tradeoff worthwhile.

## Model 1 — In-Process Loop, Postgres Advisory Lock (current)

What's shipped in this folder: `ScheduledJob<TItem>`, `AdvisoryLock`,
`PostgresAdvisoryLock`, `IdempotentJobRunner`, and
`BackgroundJobsModule.forRoot()`. No queue, no backoff policy, no
dead-letter path, no scheduling built in — each job supplies its own
`@Cron`/`OnApplicationBootstrap` wiring around the shared runner.

### Not built: job-run observability — a real Model 1 extension, not Model 2

Recorded so it isn't lost, not built speculatively: today `IdempotentJobRunner.run()`
has zero observability beyond a logged per-item failure — no record of a run
happening, succeeding, or failing anywhere queryable, and no way for an admin
screen to show "did this job run, and did it work." The design, when a real
admin-ops screen story asks for it:

```typescript
export interface JobRunSummary {
  jobName: string;
  startedAt: Date;
  finishedAt: Date;
  outcome: 'completed' | 'job_failed'; // job_failed = findDueItems() itself threw
  itemsProcessed: number;
  itemsFailed: number;
  error?: string;
}

export interface JobRunRecorder {
  recordRun(summary: JobRunSummary): Promise<void>; // best-effort — must never propagate a failure itself
}
```

`IdempotentJobRunner.run()` would track `startedAt` and running item counts,
then call `recorder.recordRun(...)` once at the end, wrapped in its own
try/catch so a failure to *record* the outcome can never mask or compound the
real one. Deliberately not the `audit-logging` pattern's `AuditEventRepository`,
even though both look like "something happened, record it" — the reliability
postures are opposite. Audit writes are critical by design (a failed write
should roll back the triggering operation); a job-run record must never
itself fail loudly enough to compound a real job failure, and its query shape
(`outcome`, `started_at`, `job_name` as real columns, not values buried in
generic JSONB) is different too. A lock-not-acquired return shouldn't get a
run record at all — a rolling deploy's overlap window makes that a normal,
frequent, uninteresting event, not something worth cluttering the history
with.

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
wrapper folder), then:

```typescript
@Module({
  imports: [
    BackgroundJobsModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION, // whatever token the app's own Drizzle db is already provided under
      imports: [DatabaseModule],             // whatever module exports that token — useExisting can't see it otherwise
    }),
  ],
})
export class AppModule {}
```

`imports` is required unless the module providing `sqlExecutorToken` is itself
marked `global: true` — `useExisting` only resolves a token NestJS can already
see in `BackgroundJobsModule`'s own providers or imports, not anywhere in the
wider application graph, so the consumer's database module has to be named
here explicitly.

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

  async processItem(invoice: Invoice) {
    // emitCritical(), not emit() — if this event also drives an audit-log listener, that
    // listener's failures must never be silently dropped (see the domain-events pattern's
    // tiering rule); a notification listener on the same event can still individually stay
    // best-effort via a plain @OnEvent() regardless of which emit method the publisher uses.
    await this.events.emitCritical('invoice.reminder_due', new PaymentReminderDue(/* ... */));

    // Only reached once the line above genuinely resolves — DomainEventEmitter awaits
    // emitAsync() internally, unlike raw EventEmitter2.emit(), which returns before an
    // async listener has even started. That's what makes "mark immediately after
    // processing" a real guarantee instead of a race.
    await withTenantContext(this.db, { kind: 'admin' }, (tx) =>
      this.invoiceRepo.markRemindedToday(tx, invoice.id));
  }
}
```

A per-item "done" marker like `last_reminded_on` can only express "at most
once per period." A tapering or capped cadence needs a count/stage column
instead — that's a business-rule decision for the consuming project to make,
not something this pattern has an opinion on.
