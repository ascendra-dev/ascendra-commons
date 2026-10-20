# Audit Logging — Module Review Report

**Date:** 2026-10-21 · **Scope:** `audit-logging.core`, `audit-logging.core.postgres-drizzle`, `audit-logging.api`,
and its UI in `ascendra-commons-ui` (`audit-logging.ui` + the `observability/audit` screens) · **Status:** complete —
functional review, flow walkthrough and backend code review. How the module works, end to end:
[`GUIDE.md`](./GUIDE.md).

`audit-logging` is the reference module: what this review settles is the standard for every module that follows. This
report records what the module does well, what was fixed during the review, and the gaps — missing or worth adding —
in priority order. Nothing in the gaps section is built yet.

## Verdict

Useful, and correct where it matters. The write path is trustworthy and the read side answers the real questions —
who changed this, what exactly changed, everything one request touched, what one actor has been doing. The gaps are
the next layer up (retention, access auditing, request context, scale), not flaws in what exists.

## What's in place

**Write path**
- Feature code raises `AuditRecordRaised` explicitly, under the one `AUDIT_EVENT_NAME`, via `emitCritical()` — a
  failed audit write propagates and, inside the change's transaction, rolls the change back.
- `AuditEventRepository` has `insert()` only — write-once by construction.
- A correlation id (`AsyncLocalStorage`) is stamped on every record, for an HTTP request and a job run alike.
- An `application` column is stamped on insert, ready for cross-product reporting.

**Read path (`audit-logging.api`, all behind `audit.view`)**
- `/audit/events` with filters (actor, entity type, action, entity id, tenant, application, correlation id, time
  range), keyset-paginated; `/audit/events.csv` streams up to `exportMaxRows` (default 100,000) with truncation
  headers.
- One record with a server-computed field diff; entity history; request / job trace; actor activity summary.
- Overview stats (KPIs, volume by day, top actions), retention figures, catalog, and coverage (`POST /audit/coverage`).
- Tenant isolation is enforced server-side: a non-platform actor is pinned to their tenant, and a cross-tenant id 404s
  exactly like a missing one.

**Screens (`ascendra-commons-ui`)**
- **Overview** — KPI tiles, volume by day, top actions. The Records tiles, each bar and each top-actions row open the
  list on exactly the window they counted.
- **Audit Log list** — Recent / Advanced Filter, search highlighting, sort, column manager, CSV export, batch
  navigation; row drill-downs (filter by actor / action / entity / correlation); record, actor, entity-history and
  trace sheets.
- **Retention & Volume** — oldest record, records, table size, volume by month.

## Fixed during the review

| Defect / change | Where |
|---|---|
| Volume-by-day bars were UTC days, and the first bar a partial day — a bar, its link and the same day picked in the calendar gave three different counts (e.g. 1 / 24 / 26). Overview stats now take `tz` and count whole calendar days in the viewer's zone. **Breaking:** `fillDailyCounts(days, counts)`, new `calendarDays`, `isValidTimeZone`. | commons `0f908ad` |
| Dashboard numbers are drill-downs: links carry the exact counted window; Advanced Filter row actions replace the copy actions (ids are copyable in the record sheet). | commons-ui `2cc6428`, `ca00bdf` |
| A dashboard link landed under the stored "Recent Events" (results filtered, wrong query selected) — the table's setup ran twice under React Strict Mode. | ascendra-ui `4b7ca47` |
| Date-only values (`YYYY-MM-DD`) formatted as the day before west of UTC. | ascendra-ui `ea4a4a4` |
| New reusable `DataTableRunQueryAction` (row drill-down) — standard for every module's list. | ascendra-ui `6949499` |
| The list links back to the overview, like Retention ("Back to overview"). | commons-ui `fd1f010` |
| **Backend review:** a bad date, `limit` or cursor → 400 (were 500; an undecodable cursor silently returned the first page again); a non-UUID record id → 404 (was 500). New `InvalidAuditCursorError`. | commons `0e922bd` |
| **Backend review:** CSV export neutralizes cells a spreadsheet would run as formulas (`= + - @`). | commons `cab8b21` |
| **Backend review:** an inbound `x-correlation-id` is kept only when well-formed (1–128 of `[A-Za-z0-9._:-]`). | commons `d2a82c7` |
| **Follow-up:** the audit API fails closed without a global `AuthorizationGuard` — new `AuthorizationEnforcedGuard` in `authorization.core`, declared on the controller; a miswired app now gets a 500 naming the fix instead of an open audit log. | commons `cf763d6`, `7bd10ab` |
| **Follow-up:** `AuditRecordRaised` takes one named `AuditRecordFields` object instead of 9 positional parameters (breaking). | commons `32968af` |
| **Backend review:** migration 0002 — indexes for the list's order `(application, occurred_at desc, id desc)`, traces `(correlation_id)` and actor activity; `EXPLAIN` on the sandbox uses each. | commons `266f6d4` |

## Gaps

### P1 — compliance and scale (what an auditor or a large customer asks first)

| Gap | Why it matters | Direction |
|---|---|---|
| **No retention / purge** | The table grows forever ("kept indefinitely" is an explicit decision, see README). | Consumer-configured `retention: { keepForDays }` (default indefinite); an automatic `background-jobs` `ScheduledJob` modelled on `JobRunPrunerJob` — daily, application-scoped, batched DELETE oldest-first, run recorded, "run now" via `JobTrigger`; the purge writes its own `audit.purged` record. A deployment that revoked DELETE gives the job its own role. Monthly partitions (purge = drop partition) when volume justifies it. |
| **Retention figures count the whole table** | The list, traces and actor activity are indexed now (migration 0002), but `count(*)` / per-month counts still read every row. | Approximate counts or caching for the platform-wide figures; monthly roll-ups or partitions at scale. |
| **Reading / exporting the audit log isn't audited** | Anyone with `audit.view` can export 100,000 rows and leave no trace; most compliance regimes expect access to audit data to be recorded. | Record exports (and optionally record views) as audit events — `audit.exported` with the filter and row count. |
| **No request context on records** | No IP, user agent, channel (UI / API / job) or on-behalf-of — when a platform admin acts inside a tenant, only one actor is recorded. | Capture request context in ambient context alongside the correlation id; add columns. Decide before more modules copy the record shape. |
| **No PII handling in `before` / `after`** | Snapshots can hold personal data; there's no redaction or masking hook, and GDPR erasure vs. immutability is undecided. | A redaction hook at `persistAuditRecord` (per entity type, field list); a documented erasure policy (e.g. pseudonymise the actor, keep the event). |

### P2 — product

| Gap | Notes |
|---|---|
| **Coverage & Gaps screen** | The API is built; the UI isn't (mocks.html shows it). It catches a feature shipping without an `AuditRecordRaised` — a real compliance aid. |
| **Top actors / per-tenant breakdown** | In mocks.html, not built. Also the proper drill-down for the "Distinct actors" KPI, which can't link today. |
| **Search is client-side** | The list's search box filters the loaded batch (50 rows), not the log; the reason text isn't searchable server-side. |
| **Volume by month is UTC** | Same fix as volume by day (`tz`). |
| **No alerting** | The overview's purpose ("activity dropped to zero", "one actor spiked") depends on someone looking. A threshold check via `notification` would make it proactive. |
| **Raw action labels** | `invoice.created` everywhere — the catalog could carry human labels. |
| **Sheets aren't linkable by URL** | A business page can link to a filtered list, but can't open an entity's history (or a trace / actor) directly. |
| **Saved queries are per browser** | Stored in localStorage — not tied to the user, other devices or teammates. |
| **No real-database tests** | The reader's SQL is asserted as rendered text; its behaviour (time-zone cast, index use) is verified only through the sandbox. |
| **No size limit on `before` / `after`** | A large snapshot bloats the table and every export. |
| **No rate limit on the CSV export** | Up to 100,000 rows per request; `rate-limiting` exists in this repo. |

### P3 — later / nice to have

- Tamper evidence — a hash chain or signed batches, or at least enforcing no UPDATE / DELETE at the database.
- SIEM forwarding / streaming export; scheduled exports.
- Archive before purge (`file-storage`); legal hold.
- Point-in-time reconstruction — "this entity's state on date X".
- Broker-transport correlation-id carry-through; a per-request application on the write side (both in README).
- No automated frontend tests (verified manually with Playwright); clickable rows are `<tr onClick>`, not keyboard
  reachable; the volume chart's tooltip shows the raw `YYYY-MM-DD`.
- Cursor precision — milliseconds in the cursor, microseconds in Postgres. Safe while every row comes from a JS
  `Date`; a row written with `now()` could be skipped at a page boundary.

## Suggested order

1. Volume-by-month `tz` — small.
2. Audit exports / reads and capture request context — they shape the record, so before more modules copy it.
3. Retention (the pruner job) and the Coverage & Gaps screen.
4. The rest of P2 as product demand appears.

## Standards this review set for future modules

- Drill-down links run the list's own filter query by URL (`?q=<queryId>&q.<field>=…`) — no bespoke trigger queries.
  ascendra-ui's `buildQuerySearch` builds the query string; the module's `links.ts` only adds the path
  (`auditLogLinks.list({ queryId, params })`, ids in `auditQueryIds`).
- A link carries exactly the window its number was counted over, anchored to when the numbers were fetched
  (`dataUpdatedAt`, never render time); verify by checking the clicked number equals the list's total.
- Row drill-downs use `DataTableRunQueryAction` (a fresh run over the filter's default range).
- Per-day statistics are counted in the viewer's time zone, whole days only.
- A distinct-count KPI doesn't link to a list of records — it needs a breakdown of its own.
- The backend conventions this review checks — input validation, cursors, CSV, headers, indexes — are listed in
  [`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md).
