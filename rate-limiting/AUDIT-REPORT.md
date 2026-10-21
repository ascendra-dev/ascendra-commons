# Rate Limiting — Module Review Report

**Date:** 2026-10-21 · **Scope:** `rate-limiting.core`, `.core.throttler`, `.core.postgres-drizzle`, `.api`, and its UI
in `ascendra-commons-ui` (`rate-limiting.ui` + the `observability/rate-limiting` screens) · **Status:** complete —
screens walked as every dev user, drill-downs checked against the list, flow walkthrough, backend code review, `EXPLAIN`
on every read. How the module works, end to end: [`GUIDE.md`](./GUIDE.md).

The second module through the review `audit-logging` set ([`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md)),
and the first of the small observability modules (`payment-link-security`, `payment-gateway-adapter`,
`idempotency-key`, `domain-events` next). Nothing in the gaps section is built yet.

## Verdict

Useful, and now safe to leave running under the very attack it reports. Before the review the log was a liability —
one awaited `INSERT` per `429` turned a flood into database load, and a malformed header or a Fastify URL could put a
caller's text or a payment-link token in the table. Both are fixed. The read side answers the operator's questions —
which route is being hammered, by whom, is it getting worse — and every number links to the rows it counted. The gaps
are scale (per-process throttle counters, full-scan storage figures) and the next layer of product (a summary on the
list, alerting, the `payment-link-security` cross-reference).

## What's in place

**Rejection path**
- `@Throttle()` exactly as `@nestjs/throttler` declares it; `RecordingThrottlerGuard` replaces `ThrottlerGuard` and
  records through the one hook the library offers. The `429` never depends on the record.
- The Postgres recorder counts in memory and upserts every 10 s — one row per route, source, limit, minute and
  correlation id; several instances merge into the same rows; flushed again on shutdown; `(overflow)` keeps route totals
  exact past 10,000 sources.
- Only the route pattern is stored, and a correlation id only when well-formed.
- `pruneRejections()` for the app's own scheduler (the sandbox: daily, 90 days).

**Read path (`rate-limiting.api`, all behind `rate-limit.view`, fails closed without the global guard)**
- The rejection log (route, source, correlation id, time range; keyset-paginated, Rule 4's cursor shape), a trace,
  per-route totals, top sources, and volume — 30 calendar days in the viewer's zone plus storage figures.
- Bad input of every kind is a 400; nothing a caller sends produces a 500.

**Screens (`ascendra-commons-ui`)**
- **Overview** — a period picker (past hour / 24 hours / 7 days), three tiles, Rejections by route and Top sources.
  The total, the busiest route, every route and every source open the list on exactly what they counted.
- **Rejections** — Recent / Advanced Filter (route, source, correlation id, range), one row per window (count, span,
  limit), a source click filters to it, row actions, the trace sheet from a row's correlation id.
- **Volume & Retention** — oldest window, stored windows, table size, rejections per day (a bar opens that day).
- Nav and every screen hidden from / denied to anyone without `rate-limit.view` (tenant admins, members).

**Sandbox** — real `429`s through throttled demo routes (`/demo/pay/:token`, `/demo/login`, `/demo/quotes`): an
enumerator, a brute-forcer, a partner with correlation ids, two sync jobs (one correlation id across two routes), a
150-address botnet past the buffer; `simulate` adds bursts.

## Fixed during the review

| Defect / change | Where |
|---|---|
| **Write amplification:** one awaited `INSERT` per `429` — a flood became Postgres load. Now buffered + upserted per window; migration 0002 folds old rows. **Breaking:** window fields replace `rejectedAt`. | commons `9c89db0` |
| Top sources endpoint, `pruneRejections()`, `AuthorizationEnforcedGuard` on the controller; README on the tracker (`trust proxy`, never `true`), per-user `getTracker()`, edge limiting, retention. | commons `c3a6781` |
| A bad date / `limit` / cursor → 500; a garbage cursor silently restarted at page 1. Now 400s; `InvalidRateLimitCursorError`. | commons `df7555e` |
| Volume & storage endpoint (`?tz`, whole local days). | commons `00ae9b0` |
| List / trace returned the domain type, not api-contract Rule 4's `{ data, meta }` (**breaking**). | commons `81f42f0` |
| **Backend review:** `x-correlation-id` stored as sent — a 3,008-character `<script>…` and `bad id;drop` reproduced on the sandbox. Now the audit rule (1–128 of `[A-Za-z0-9._:-]`). | commons `4e4bb4c` |
| **Backend review:** without `request.route` (Fastify, a harness) the route fell back to the resolved URL — a `/pay/<token>` rejection stored the token, query string included, one row per token (the old spec asserted it). Now the adapter's pattern, else `Controller.method`. | commons `4e4bb4c` |
| **Backend review:** `EXPLAIN` — the list sorted every matching row (no `id` in the time index); a trace scanned the application. Migration 0003: `(application, window_start desc, id desc)` and a partial `correlation_id` index; re-`EXPLAIN`ed. | commons `8e80c07` |
| Mocks redesigned for window rows; Volume & Retention its own screen. | commons `68f3060`, `843430b` |
| The UI: Overview, Rejections + trace sheet, Volume & Retention; review rounds on the period control, the lists and alignment. | commons-ui `b94b242`, `652e53d`, `50144f4`, `bd7dbcd` |
| **ascendra-ui**, found here: reopening a filter form emptied its selects (Radix's hidden native select echoed `''`) — Run Query then dropped those filters; the query bar lost its criteria while a form was open; a row action reopened the form on the previous run's draft. | ascendra-ui `77bc845`, `db41cd3` |
| **ascendra-ui**, built for this module: `SegmentedControl`; `ColumnDef.align` (a right-aligned column's header followed its cells). | ascendra-ui `d79737f`, `900a33a` |
| Sandbox: vendored and wired (guard first, `trust proxy 1`, `rate-limit.view` platform-only, demo routes, seed / simulate, daily prune); partner sync jobs for a multi-window trace. | sandbox `a698597`, `4aa7bf0` |

## Gaps

### P1 — security and scale

| Gap | Why it matters | Direction |
|---|---|---|
| **Throttle counters are per process** | With N instances behind a load balancer each counts separately — the effective limit is N × the declared one, exactly when scaling out for load. (The rejection *log* already merges.) | A Redis `ThrottlerStorage` (an atomic Lua increment + expiry), configured in the app's `ThrottlerModule.forRoot({ storage })` — README "Model 2". Build when a second instance exists. |
| **Storage figures read every row** | `volume`'s `min` / `count(*)` scan the application's rows (index-served, but all of them); fine at today's volume, slow at millions of windows. | `pg_class.reltuples` / cached counts for the storage tiles; keep the per-day sum on the window index. |
| **Losing counts is silent** | A failed flush drops its counts (logged only); a crash loses up to 10 s. Accepted for a pattern log — but nothing shows an operator that the log has gaps. | Count dropped rejections (a metric, or a `(dropped)` row); surface it on Volume & Retention. |

### P2 — product

| Gap | Notes |
|---|---|
| **The list can't show the sum it adds up to** | A tile says "944 rejections"; the list it opens shows 105 *windows*. The numbers agree (checked in this review), but only an API script can see it. A summary (`GET …/summary` with the list's filters → rejections, windows, sources) beside the batch navigator. |
| **`payment-link-security` cross-reference** | The README's strongest signal — rejections on `/pay/:token` alongside a spike of `not_found` resolutions — isn't on any screen. Build with that module (next): a link from a route to its resolutions for the same window. |
| **No alerting** | A flood is visible only if someone looks. A threshold (rejections per route per window) raising a notification via `notification`. |
| **No trend on the tiles** (AUI-014) | The catalog takes only `since`; a "vs. previous period" needs `until` (or a stats endpoint with both windows). |
| **No catalog of configured limits** | Which routes are throttled, at what limit — including those with zero rejections — isn't visible. The throttler's metadata could be listed at boot. |
| **Proxy misconfiguration is invisible** | If `trust proxy` is wrong, every rejection shows the proxy's address. A warning when one private-range identifier dominates. |
| **Per-user tracking isn't demonstrated** | The README documents a `getTracker()` override; the sandbox only counts by IP, so a signed-in route's per-user rows (and tenant attribution) are untested. |
| **A denied user sees three 403s on the Overview** | Tiles and both lists each report it; one message would read better. Only reachable by URL (the nav hides the entry). |
| **Search is client-side; saved queries per browser** | ascendra-ui behaviour, shared with audit. |

### P3 — later / nice to have

- No real-database tests in CI — the migration fold, the upsert merge, `array_agg`, the batched prune and the plans were
  verified against the sandbox's Postgres 16 by hand.
- Recorder options aren't validated — `flushIntervalMs: 0` would flush in a tight loop.
- Block / allow actions from the screens (an edge or gateway concern; the screens could produce the list).
- Clickable rows are `<tr onClick>`, not keyboard-reachable (as audit).
- `tableSizeBytes` is the whole table, every application sharing it.
- Sandbox data is recent only — the recorder stamps the real clock, so history accumulates only while `simulate` runs.

## Suggested order

1. `payment-link-security` — the next module; build the cross-reference with it.
2. The list summary — small, and it makes every drill-down checkable on screen.
3. Alerting, once `notification` is in the sandbox.
4. Redis storage when a deployment runs a second instance; the storage-figure estimates as volume grows.

## Standards this review set for future modules

- **An observability write path does no I/O per event when the event is the attack** — count in memory, upsert on an
  interval, bound the buffer with an overflow bucket. `payment-link-security`'s resolution log (one row per lookup,
  including every enumeration attempt) is the next to check against this.
- **Never store a resolved URL** — record the route pattern; a URL can carry a secret (a payment-link token) and
  splits one route into a row per id.
- **Every stored inbound header is validated** — the correlation-id rule is now in two modules, deliberately
  duplicated (each copyable on its own).
- **When a number counts something the list doesn't show row-by-row** (rejections vs windows), verify the drill-down
  against the list's *sum*, and plan a summary for the screen.
- **When a mock needs a control ascendra-ui lacks, build it there** (here `SegmentedControl`) — don't substitute the
  nearest existing component.
- The backend conventions are unchanged from [`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md); this module
  passes every item that applies (no tenant scope, no record-by-id, no CSV).
