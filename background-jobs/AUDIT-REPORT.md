# Background Jobs — Module Review Report

**Date:** 2026-10-23 · **Scope:** `background-jobs.core`, `.core.postgres-drizzle`, `.api`, and its UI in
`ascendra-commons-ui` (`background-jobs.ui` + the `observability/background-jobs` screens) · **Status:** complete —
screens walked as every dev user, drill-downs checked against the list, backend code review with each suspect
reproduced on the sandbox, `EXPLAIN` on every read, bad inputs probed. How the module works, end to end:
[`GUIDE.md`](./GUIDE.md).

The fifth module through the review `audit-logging` set ([`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md)),
and the last of the small observability modules (after `rate-limiting`, `idempotency-key` and `domain-events`). Next:
extract the observability screens' shared pieces. Nothing in the gaps section is built yet.

## Verdict

The pattern itself — a job says what's due and how to process one item; one runner takes the lock, isolates each
item's failure, and records the run — was sound and is unchanged. What sat around it wasn't ready: the dashboard read
the whole history on every load, the history could only be read one job at a time, a run with an odd label silently
vanished from it, nothing could see a lock a dead process left, and **Run now held the request for the whole run** — a
job longer than a proxy's timeout showed the admin an error for a run that went on to finish. All fixed. The run path
writes one row per run off every request path, so the "no I/O per event" rule the other modules needed doesn't apply.
The real gaps: a process that dies mid-run leaves no run at all (only an expired lock), a chronically failing item
retries forever, and nothing alerts — the dashboard knows a job is broken, but only whoever opens it learns.

## What's in place

**Run path**
- `IdempotentJobRunner`: lock → `findDueItems()` → each item isolated → release (guarded) → one summary, recorded
  best-effort. A held lock is not a run. A job-level failure is recorded, then rethrown to the scheduler.
- Two locks: `PostgresLeaseLock` (a row + lease, heartbeat every `leaseSeconds / 3`, any pooler, listable) and
  `PostgresAdvisoryLock` (session-level, dedicated connection).
- `PostgresJobRunRecorder` normalizes each summary (NULs, caps, dates, counts, correlation-id rule) before its one
  `INSERT`.
- `JobRunPrunerJob` — the module's own retention as a `ScheduledJob`, batched.

**Run now**
- `JobTrigger.start()` answers once the lock is taken: `POST /jobs/:name/run` → 202 `{ status, correlationId }`, 404
  unknown, 409 already running; every attempt audited through an optional port; correlation id from the header, the
  app's ambient id, or fresh.

**Read path (`background-jobs.api`, `job.view`; Run now `job.run`; fails closed without the global guard)**
- The dashboard with derived health (last clean run, consecutive failures, declared / inferred cadence, overdue,
  triggerable), alerts, the runs list across jobs (Rule 4, keyset at microsecond precision), run detail with the full
  stack, a trace, chronic failed items, summary and 30-day volume in the viewer's zone, the Lock Inspector.
- Every read on an index; every bad input a 400, a missing run or unknown job a 404.

**Screens (`ascendra-commons-ui`)**
- **Overview** — 24 h / 7 d / 30 d; Runs, With failed items and Job failures tiles each open Runs on exactly what they
  counted; Needs attention; the Needs attention and Jobs lists (each row a link to its Job screen).
- **Runs** — Recent / Advanced Filter; the run sheet (full stack, failed items); the trace sheet.
- **Job** — health, chronic failed items, recent runs, Run now: one toast that follows the run and stays until closed;
  disabled with a tooltip for a viewer without `job.run`; a note when the job isn't triggerable.
- **Locks** — held and expired rows, each a link to its job.
- **Volume & Retention** — oldest run, rows, table size, runs per day stacked by outcome; each day a link.
- Hidden from / denied to tenant admins and members.

**Sandbox** — seven demo jobs, one per dashboard case (`src/demo/demo-jobs.ts`): healthy, a chronic failed item,
broken (`findDueItems()` throws), cadence inferred, overdue with a dead holder's lock, a 15-second manual-only job, and
a declared-only job that never ran. The other modules' retention tasks run as `ScheduledJob`s too. History seeded
through the real runner: 15,941 runs over 90 days.

## Fixed during the review

| Defect / change | Where |
|---|---|
| **Recorder:** a NUL byte in an error or `describeItem()` label, an unbounded stack, an Invalid Date or a non-integer count failed the `INSERT` — and the best-effort contract swallowed the failure, so the run silently vanished from the history. Each summary is now normalized first. | commons `b02824e` |
| **Pruner:** one unbounded `DELETE` held a long lock on the table the recorder writes. Now batches of 5,000. | commons `fb01962` |
| **Reads and API:** the dashboard's `row_number()` window read every run on every load; history only per job; no index for the unfiltered list, failures or a trace (0001's single index); the cursor at JS millisecond precision over a microsecond column; a garbage cursor restarted at page one; a bad date or a non-numeric run id → 500; no `AuthorizationEnforcedGuard`; unknown job / already running → 200 with a status. Now a skip scan + per-job index reads, `GET /jobs/runs` across jobs, migration 0003, a JSON microsecond cursor, summary and volume, Rule 4, 400 / 404 / 409 (**breaking**). | commons `fc2e515` |
| **Lock Inspector** — `GET /jobs/locks`: held and expired lease rows (the only trace of a process that died mid-run). | commons `fe9296b` |
| **Trace:** a Run now from a screen got a fresh correlation id and the request's audit record another — they never met. `correlationIdResolver`: header → ambient → fresh. | commons `f6a96d0` |
| Mocks rewritten — Overview, Runs, Run and Trace sheets, Job with Run now, Locks, Volume & Retention. | commons `c373091` |
| **Backend review:** `?trigger=manual` was the one list filter with no index — it walked every run in the range. Partial `manual_idx`, migration 0004. | commons `7bdd6cf` |
| **Backend review:** `GET /jobs/<unknown>/failed-items` → 200 `[]` — "nothing keeps failing" and "no such job" read the same. Now 404. | commons `e2f21a2` |
| **Backend review:** Run now awaited the whole run — reproduced on the sandbox with the 15-second job; behind a proxy's 30–60 s timeout a long job would show an error for a run that finishes, inviting a second press. Now 202 once the lock is taken (0.01 s), and the screen follows the run (**breaking**). | commons `aaffe5b`, commons-ui `2e4310c` |
| Sandbox: vendored and wired (lease lock, recorder, cadences, inspector, audit emitter through domain-events, ambient correlation id; `job.view` admin + support, `job.run` admin), the other modules' retention timers turned into `ScheduledJob`s, demo jobs and history; re-vendored with the fixes. | sandbox `39b5653`, `91c061e`, `d067eb3`, `1324cde` |
| The UI: Overview, Runs + run and trace sheets, Job with Run now, Locks, Volume & Retention; Run now's result toast stays until closed. | commons-ui `3d6b164`, `2e4310c`, `47108d6` |
| **ascendra-ui**, found while building this module: a note under a table drew a stray top border (`CardFooter` in a `TableWrapper`); rows, chart days and header buttons that open a page navigated by `onClick`, so the browser never showed where they went. `CardFooter` fixed; new `TableRowLink` and `ChartBarLink`; every observability screen converted. | ascendra-ui `3d9e298`, `e48bf8e`, `ee5800b`, `d773935`; commons-ui `ba14747` |

## Gaps

### P1 — correctness and scale

| Gap | Why it matters | Direction |
|---|---|---|
| **A run that dies mid-run leaves no run** | The summary is written after the run, so a crash, OOM kill or deploy mid-run records nothing: the history shows the previous run as the last, the job looks merely late. The lease row (Locks → expired) is the only trace, and only until the next run takes it over; with the advisory lock there's none. | Write a `running` row when the lock is taken (the `onStarted` moment) and update it at the end; a `running` row whose lock has lapsed is an **abandoned** run — a fourth outcome the Overview counts. Also gives the screens "running now". |
| **Losing runs is silent** | A failed `INSERT` is logged and swallowed (by contract) — the history then under-counts with nothing to say so. Same gap as rate-limiting, idempotency and domain-events. | Count recorder failures; show the count on Volume & Retention. |
| **A lapsed lease can run a job twice at once** | If the heartbeat can't reach the database for a whole lease (default 900 s), another instance takes the lock while the first is still running — logged as a WARN, nowhere on a screen. Per-item idempotency makes it safe only if every job honours the contract. | Surface heartbeat losses (a counter, or a flag on the run row once runs are written at start); document `leaseSeconds` ≥ 3 × the longest item. |

### P2 — product

| Gap | Notes |
|---|---|
| **Nothing alerts** | `GET /jobs/alerts` is a list someone must open. A broken job (`kyc-expiry-scan` fails every hour) should reach someone — a check on the job's own schedule raising a notification via `notification`, with ack state. |
| **A chronic item retries forever** | No backoff, no dead letter, no "skip this item" — the README's Model 2 trigger. The chronic-offender view shows it; nothing can act on it. |
| **Cadences are declared twice** | The app's `@Cron` and the `cadences` hint are separate — `statement-export` is "overdue" in the sandbox precisely because they drifted. Read `@nestjs/schedule`'s `SchedulerRegistry` for the real next fire, and keep `cadences` for jobs scheduled elsewhere. |
| **Stack traces are shown as stored** | A job-level error's stack (≤ 16,000 chars) goes to every `job.view` holder; a driver error can quote SQL with values. A redaction hook shared with audit-logging (idempotency's P1). |
| **No force-release** | An expired lock is taken over by the next run, but a stuck one (a live process hung on an item) can't be freed from the Locks screen. A separate, audited `job.release-lock` action. |
| **No trend on the tiles** (AUI-014) | `summary` takes only `since`; "vs. previous period" needs `until`. |
| **A denied user sees several errors on the Overview** | The tiles and both lists each report the 403 (the shared observability-console gap). Only reachable by URL — the nav hides the entry. |

### P3 — later / nice to have

- No real-database tests in CI — the lease upsert's race, the skip scan, time-zone bucketing and the plans were
  verified on the sandbox's Postgres 16 by hand.
- `consecutiveFailures` reads at most 50 (the runs the dashboard inspects per job) — "50+" would be honest.
- `volume()`'s oldest / row count read every retained run — index-only, and run history is small by nature (one row
  per run: ~16,000 in 90 days for ten jobs), so not a P1 here as it was for domain-events.
- The advisory lock can't be listed — the Lock Inspector answers `supported: false` (by design).
- `tableSizeBytes` is the whole table, every application sharing it.
- Recorder and lock options aren't validated (`leaseSeconds: 0` would expire every lock at once).

## Suggested order

1. Runs written at start (the `running` row and the abandoned outcome) — it closes the P1 and gives the screens "running
   now".
2. Alerting, once `notification` is in the sandbox — with the same rule as Needs attention.
3. Extract the observability screens' shared pieces — all five small modules are built.

## Standards this review set for future modules

- **A long action answers once it has started, never after it finishes** — 202 with an id the screen can follow
  (here the correlation id and the trace), so a proxy's timeout can't turn a success into an error. The screen follows
  in one toast that survives leaving the page and stays until closed.
- **A record written only at the end loses the work that died** — write at the start and close at the end, or expose
  what the dead holder left (here the Lock Inspector) until that's built.
- **An empty list for an unknown parent is a 404** — "nothing failed" and "no such job" must not read the same.
- **Every filter a screen uses has an index — a rare value gets a partial one** (`manual`, as `correlation_id` did).
- **A best-effort writer still normalizes** — a swallowed failure is worse than a loud one: the record vanishes.
- **A link is a link** (UI) — a row, chart column or button that opens another page is a real `<a>` (`TableRowLink`,
  `ChartBarLink`, `Button asChild` + `Link`), so the browser shows where it goes; a row that opens a sheet keeps
  `onClick`.
- The backend conventions are otherwise unchanged from [`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md);
  this module passes every item that applies (no tenant scope, no CSV, no write on an attack path).
