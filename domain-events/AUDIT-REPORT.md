# Domain Events — Module Review Report

**Date:** 2026-10-22 · **Scope:** `domain-events.core`, `.core.in-process`, `.core.broker`, `.core.postgres-drizzle`,
`.api`, and its UI in `ascendra-commons-ui` (`domain-events.ui` + the `observability/domain-events` screens) ·
**Status:** complete — screens walked as every dev user, drill-downs checked against the list, backend code review with
the suspect reproduced on the sandbox, `EXPLAIN` on every read. How the module works, end to end: [`GUIDE.md`](./GUIDE.md).

The fourth module through the review `audit-logging` set ([`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md)),
and the third small observability module (after `rate-limiting` and `idempotency-key`; `background-jobs` next).
Nothing in the gaps section is built yet.

## Verdict

The event pattern itself — `emit()` vs `emitCritical()`, `@OnCriticalEvent()`, the transport behind a token — was sound,
and is unchanged. Its observability wasn't fit to leave running: every critical emit (every audit record) paid an
awaited database insert inside the producer's request; the screens counted by write time, so anything backdated landed
on "now"; nothing pruned the table; and the API trusted its input. All fixed — and the new buffered write path was
itself caught losing a whole batch to one malformed event, now fixed too. The module's real value is the **Wiring**
screen: it is the only place the README's warning ("if an event has any critical listener, every producer must use
`emitCritical()`") is actually checked. The gaps: the checks don't alert anyone, and the catalog / storage reads scan
the retained window.

## What's in place

**Emit path**
- `emit()` / `emitCritical()` unchanged; the in-process transport records one delivery per call — `delivered`,
  `no_listeners`, `dispatch_failed` — before awaiting listeners, so a listener's failure never reads as a delivery one.
- The Postgres recorder buffers in memory (no I/O on the producer's path), writes every 10 s in chunked multi-row
  inserts, is bounded (`maxBufferedRows`), flushes on shutdown, normalizes each delivery so one bad one can't sink a
  batch, and stores a correlation id only when well-formed. Never the payload.
- `pruneDeliveries()` for the app's scheduler (the sandbox: daily, 90 days).

**Read path (`domain-events.api`, all behind `domain-events.view`, fails closed without the global guard)**
- The log (event, method, status, correlation id, range; keyset on `occurred_at, id`; Rule 4), a trace, the summary and
  per-event catalog over a period, 30-day volume in the viewer's zone, and the live listener catalogue.
- Every read on `occurred_at`; every bad input a 400.

**Screens (`ascendra-commons-ui`)**
- **Overview** — 24 h / 7 d / 30 d; four tiles each opening Deliveries on exactly what it counted (status and method
  are list filters, so every tile links); Busiest events; Wiring problems.
- **Deliveries** — Recent / Advanced Filter, event-name click-to-filter, the trace sheet (a checkout shows its two events).
- **Wiring** — the delivery catalog × the listener catalogue: critical listener raised with `emit()` (red), fires into
  nothing (amber), never fires (blue); problems first.
- **Volume & Retention** — oldest delivery, rows, table size, deliveries per day stacked by status.
- Nav and screens hidden from / denied to tenant admins and members.

**Sandbox** — demo events and listeners shaped for the screens (`src/demo/demo-events.ts`), raised through the real
emitter with backdated `occurredAt` (`src/cli/domain-event-history.ts`), plus audit's own `emitCritical()` calls:
5,998 deliveries over 90 days, 168 with no listener; one critical listener raised with `emit()` (Treasury, which
sometimes throws), one listener whose event never fires.

## Fixed during the review

| Defect / change | Where |
|---|---|
| **Write path:** one awaited `INSERT` per `emitCritical()` — a database round trip inside every critical producer's request (every audit record). Now buffered, chunked, bounded, flushed on shutdown; correlation-id rule. | commons `6c68525` |
| **Read model:** counted by `delivered_at`, so a backdated or replayed event landed on "now"; stats behind a `?window=` that silently defaulted; the catalog scanned all history; no index for the unfiltered log (0001's indexes led with `event_name` / `status`) or a trace; list / trace in the domain shape; a garbage cursor restarted silently at page one; a bad date → 500; no `AuthorizationEnforcedGuard`; no retention. Now reads on `occurred_at`, summary / period catalog / volume, migration 0002, Rule 4, 400s, the guard, `pruneDeliveries()` (**breaking**). | commons `b1b3d39` |
| Mocks rewritten — Event Catalog, Listener Catalogue and Wiring Health merged into one Wiring screen. | commons `79127dd` |
| **Backend review:** one malformed delivery (an `occurredAt` that went through JSON, or none) failed the whole buffered `INSERT` — reproduced on the sandbox: 5 good + 2 bad → **0 rows**. Each delivery is now normalized as it's buffered — 7 of 7. | commons `e254a1b` |
| Sandbox: vendored and wired (recorder, read API sharing the emitter's catalogue, platform-only action, daily 90-day prune), demo events and history; re-vendored with the fix. | sandbox `457abec`, `54156c7`, `bc14464` |
| The UI: Overview, Deliveries + trace, Wiring, Volume & Retention. | commons-ui `74b8427` |
| **Audit's events didn't trace:** audit-logging keeps its correlation id in `AsyncLocalStorage` and producers raise `AuditRecordRaised` without `emit()`'s third argument — 3,810 of the sandbox's 5,998 deliveries had none. Now `correlationIdResolver` on `InProcessDomainEventEmitterModule.forRoot()` supplies the ambient id when none is passed (an explicit one wins; a failing resolver changes nothing); the sandbox wires audit's `getCurrentCorrelationId`. No dependency on audit-logging. | commons `03d8fe7`, sandbox |
| **ascendra-ui**, found while building this module: two tables with the same query id (`recent`) shared one React Query cache entry — opening Claims after Rejections rendered the wrong rows and crashed. The key is now scoped by `tableId`. | ascendra-ui `55ac3a1` |

## Gaps

### P1 — correctness and scale

| Gap | Why it matters | Direction |
|---|---|---|
| **The catalog and storage figures scan the retained window** | `deliveryCatalog()` without `since` (the Wiring default, never-fires) and `volume()`'s `min` / `count(*)` read every retained row — index-served, but all of them; fine at 6,000, slow at tens of millions. | A daily rollup table (event × day × method × status counts) the catalog and volume read; `pg_class.reltuples` for the row-count tile. |
| **Losing deliveries is silent** | A failed flush or a full buffer drops rows (logged only) — and the screens then under-count with nothing to say so. Same gap as rate-limiting and idempotency. | Count dropped deliveries; show it on Volume & Retention. |

### P2 — product

| Gap | Notes |
|---|---|
| **Wiring problems don't alert** | A critical listener raised with `emit()` is a swallowed failure in production — it should reach someone, not wait for a screen. A daily check (the same join, server-side) raising a notification via `notification`. |
| **The wiring join is client-side** | Fine for one console; a second consumer (an alert, a CI check) would re-implement it. Move `wiringRows()` behind an endpoint when the alert is built. |
| **Listener catalogue is per process** | A broker transport's listeners in other services are invisible — never-fires would misfire. Documented; revisit with Model 2. |
| **No trend on the tiles** (AUI-014) | `summary` takes only `since`; "vs. previous period" needs `until`. |
| **Dispatch failed is near-unreachable** | Correct (a listener's throw is a rejection, not a transport failure), but the tile reads 0 forever in-process. Keep it — it's the broker transport's signal — and say so on the tile. |
| **A denied user sees three errors on the Overview** | The tiles and both cards each report the 403 (the shared observability-console gap). Only reachable by URL — the nav hides the entry. |

### P3 — later / nice to have

- No real-database tests in CI — the batched insert, `array_agg`, time-zone bucketing and plans were verified on the
  sandbox's Postgres 16 by hand.
- Recorder options aren't validated — `flushIntervalMs: 0` would flush in a tight loop (as rate-limiting).
- The listener catalogue rescans every provider per call — cache it at bootstrap if the screen is polled.
- Rows that open a sheet are `<tr onClick>`, not keyboard-reachable — rows that open a page are real links since 2026-10-23 (`TableRowLink`; [background-jobs' report](../background-jobs/AUDIT-REPORT.md)).
- `tableSizeBytes` is the whole table, every application sharing it.

## Suggested order

1. Alerting on wiring problems, once `notification` is in the sandbox.
2. The rollup table, when a deployment's log passes a few million rows.
3. `background-jobs`, the next module.

## Standards this review set for future modules

- **A buffered writer normalizes each item as it buffers it** — a multi-row `INSERT` fails as a whole, so one malformed
  item (a date that went through JSON, a NUL in an error message) must never reach it.
- **Screens count by the fact's own time** (`occurred_at`), not the row's write time — a backdated, replayed or late
  write lands on its day.
- **When every number on a screen can be a list filter, every tile links** — and the module's list should expose the
  filters its tiles count by (here status and method), so no tile is a dead end.
- **A module whose value is a cross-check** (here: declared listeners × what fired) puts that check on its own screen,
  not split across catalogs — and the join lives in one function both screens share.
- The backend conventions are otherwise unchanged from [`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md);
  this module passes every item that applies (no tenant scope, no record-by-id, no CSV).
