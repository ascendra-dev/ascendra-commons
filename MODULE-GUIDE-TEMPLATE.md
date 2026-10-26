# Module Guide & Review — Template

What every module in this repo documents beside its `README.md`, and the conventions a module's review checks.
Set by the `audit-logging` review (2026-10) — [`audit-logging/GUIDE.md`](./audit-logging/GUIDE.md) and
[`audit-logging/AUDIT-REPORT.md`](./audit-logging/AUDIT-REPORT.md) are the worked example; `rate-limiting`
([`GUIDE.md`](./rate-limiting/GUIDE.md), [`AUDIT-REPORT.md`](./rate-limiting/AUDIT-REPORT.md)) the second;
`idempotency-key` ([`GUIDE.md`](./idempotency-key/GUIDE.md), [`AUDIT-REPORT.md`](./idempotency-key/AUDIT-REPORT.md))
the third; `domain-events` ([`GUIDE.md`](./domain-events/GUIDE.md), [`AUDIT-REPORT.md`](./domain-events/AUDIT-REPORT.md))
the fourth; `background-jobs` ([`GUIDE.md`](./background-jobs/GUIDE.md),
[`AUDIT-REPORT.md`](./background-jobs/AUDIT-REPORT.md)) the fifth; `notification` ([`GUIDE.md`](./notification/GUIDE.md),
[`AUDIT-REPORT.md`](./notification/AUDIT-REPORT.md)) the first product module. Complements
[`MODULE-STANDARD.md`](./MODULE-STANDARD.md) (how a module is structured), which this doesn't repeat.

## The three documents

| File | Answers | Written for | Update when |
|---|---|---|---|
| `<module>/README.md` | What is it, how do I consume it? | A consuming app's developer | The public surface changes |
| `<module>/GUIDE.md` | How does it work, how do I change it safely? | A developer new to the module | A path, a layer or a rule changes |
| `<module>/AUDIT-REPORT.md` | Is it complete and correct? What's missing? | Whoever plans the next work | After a review; as gaps get built |

Link all three from each other, and the module README's "What's not built" to the report.

## `GUIDE.md` — required sections

1. **What it does, in one minute** — purpose, and a vocabulary table of the module's own terms.
2. **Packages and dependencies** — a Mermaid graph of the packages and what each ships / never depends on.
3. **Framework building blocks** — the NestJS pieces the module uses (dynamic modules, tokens, ports, guards,
   decorators, middleware, listeners), each with a real excerpt. Skip what the module doesn't use.
4. **Wiring it into an app** — the reference consumer's config (the sandbox), and a numbered checklist.
5. **Each path, end to end** — a sequence or flow diagram per write / read path, then each layer with its code.
   Include failure semantics (what propagates, what rolls back, what doesn't).
6. **Every endpoint** — route, reader/port call, behaviour that isn't obvious.
7. **Security model** — a table: authentication, authorization, tenant scope, application scope, existence leaks,
   injection, input validation, exports. Then what depends on the consuming app's wiring.
8. **Data model, indexes, migrations** — DDL, an index table mapping each index to the read it serves.
9. **Testing** — commands, the spec patterns, what isn't covered.
10. **How to change things** — add a field / filter / endpoint, change a shape, ship to the sandbox.
11. **Latest review** — fixed (before → after, commit) and open findings.
12. **File map.**

Excerpts are real code, trimmed with `// …` — never pseudo-code. Name the file above each one.

## `AUDIT-REPORT.md` — required sections

Date and scope · verdict · what's in place · fixed during the review (with commits) · gaps as **P1** (compliance,
security, scale) / **P2** (product) / **P3** (later), each with why it matters and a direction · suggested order ·
standards the review set.

## How a module review runs

1. **Screens** — walk every screen with the module owner; fix UI-library issues at the library.
2. **Drill-downs** — every number that can link does, carrying exactly the window it counted.
3. **Each screen's data** — significance, cost, correctness (time zones, partial windows).
4. **Flow walkthrough** — one request end to end; becomes the guide's §5.
5. **Backend code review** — read every source file; reproduce each suspected bug against the sandbox **before**
   fixing, re-probe after; one commit per fix, with tests.

## Backend conventions a review checks

**Structure**
- [ ] Ports in `.core`, one stack adapter per package, the API depends on the port only (`scripts/check.js`).
- [ ] Injection tokens are `Symbol`s; adapters bind them with `useExisting` / `useValue`; every `forRoot` takes `imports`.
- [ ] Domain results stay domain types; the controller alone shapes the wire format (api-contract).

**Security**
- [ ] Every route declares `@RequiresAction(...)` or `@NoActionRequired()` — `AuthorizationGuard` denies undeclared routes.
- [ ] Every `.api` controller declares `@UseGuards(AuthorizationEnforcedGuard)` — it fails closed when the app forgot the
      global `AuthorizationGuard` (otherwise `@RequiresAction` goes unread).
- [ ] An event or record with several same-typed fields takes one named object, not positional parameters.
- [ ] Tenant scope is forced in the service for a non-platform actor — never trusted from the request.
- [ ] Every read is scoped to the configured `application`.
- [ ] A record the actor may not see and a missing record give the same 404.
- [ ] Every SQL value is a bound parameter — dates, zones, ids included. No string-built SQL.
- [ ] A caller's mistake is a 400 / 404 with a message saying what to fix — **never a 500**. Probe: a bad date, a bad
      number, a garbage cursor, a malformed id.
- [ ] A cursor the reader didn't issue is rejected (400) — never silently ignored (that restarts at page 1).
- [ ] A cursor is JSON (base64url), not a delimited string — a caller-chosen part can hold the delimiter.
- [ ] A cursor carries the sort key at the column's precision: a `timestamptz` from `now()` is microseconds, a JS
      `Date` milliseconds — serialize the boundary in SQL (`to_char(… 'US')`), or page 2 skips rows.
- [ ] A NUL byte in any text param or path id is a 400 (Postgres `text` rejects it — otherwise a 500).
- [ ] A record that isn't there is a 404, not a 200 with an empty body; an unknown enum value is a 400, not an empty list.
      A list under a parent that doesn't exist (an unknown job's failed items) is a 404, not `[]`.
- [ ] An action that can outlast a proxy's timeout (30–60 s) answers once it has started — 202 with an id the caller
      follows (a correlation id + a trace read) — never after it finishes.
- [ ] Exported CSV neutralizes cells starting with `= + - @`, tab or CR.
- [ ] A value interpolated into HTML (an email body, a rendered page) is escaped — the template's markup is the author's,
      the variables are what users typed.
- [ ] An answer that links to a row a buffered writer holds flushes it first — and a once-only check reads the row.
- [ ] Inbound headers that end up stored (e.g. `x-correlation-id`) are validated — and one that becomes a key
      (`Idempotency-Key`) is bounded below the index row limit, or the request it protects is a 500.
- [ ] Nothing stores a resolved URL — record the route *pattern*: a URL can carry a secret (a token) and splits one
      route into a row per id. Check the fallback when the HTTP adapter doesn't populate the pattern.

**Data**
- [ ] Every read a screen makes has an index — check with `EXPLAIN` on the sandbox (with `enable_seqscan = off` on
      a small table). List the index → read mapping in the guide. A filter on a rare value gets a partial index.
- [ ] Migrations: `NNNN_<snake_case>.sql`, never edit a released one; mirror in the Drizzle schema; note
      `CREATE INDEX CONCURRENTLY` for large tables.
- [ ] Per-day statistics are bucketed in the viewer's time zone, whole days only.
- [ ] Keyset pagination with a stable tie-break (`occurred_at, id`) — and an index carrying the tie-break, or the list
      sorts every row; default and max page size. The condition leads with the indexed column
      (`ts <= b and (ts < b or id < i)`) — the `OR` alone is a Filter, scanned from the top on every page.
- [ ] A write path that records the attack itself (rejections, failed lookups) does no I/O per event — count in
      memory, upsert on an interval, bound the buffer (an overflow bucket keeps totals exact). The same for any log
      written on a producer's own path (domain-event deliveries).
- [ ] A buffered writer normalizes each item as it buffers it — a multi-row `INSERT` fails as a whole, so one malformed
      item (a date that went through JSON, a NUL in an error message) must not reach it.
- [ ] Screens count by the fact's own time (`occurred_at`), not the row's write time.
- [ ] A best-effort writer (one that must not throw) still normalizes what it writes — its swallowed failure makes the
      record vanish without a trace.
- [ ] A record written only when work finishes loses the work that died — write at the start and close at the end,
      or name what a dead worker leaves behind (a lapsed lock) and show it.

**Quality**
- [ ] Specs per layer: reader (rendered SQL + bound params), service (rules, validation), module (wiring / routing).
- [ ] A breaking change: Conventional Commit `!` + `BREAKING CHANGE:` footer.
- [ ] Shipped to the sandbox (`ascendra-commons.js update --from`), migrated, rebuilt and probed.

## UI conventions a review checks (ascendra-commons-ui)

- [ ] Drill-down links run the list's own filter query by URL (`?q=<queryId>&q.<field>=…`, `buildQuerySearch`); the
      module's `links.ts` adds only the path; query ids in one exported constant.
- [ ] A link carries exactly the window its number was counted over, anchored to when the numbers were fetched
      (`dataUpdatedAt`, never render time — that breaks hydration). Verify: the number clicked equals the list's total
      — or its *sum*, when the number counts something the rows aggregate (rejections in rejection windows).
- [ ] Row drill-downs use `DataTableRunQueryAction`.
- [ ] A sheet never opens another sheet — an id inside a sheet copies; drill-downs start from a page.
- [ ] A distinct-count number doesn't link to a list of records — it needs its own breakdown.
- [ ] Test URL triggers with a stored last run in the browser, not only a fresh one.
- [ ] Pixel diffs in dark mode use a zero threshold — dark-on-dark changes hide under a tolerance.
- [ ] A control the mock shows but ascendra-ui lacks is built in ascendra-ui (as `SegmentedControl` was), not replaced
      by the nearest existing component.
- [ ] Anything that opens another page is a real link, so the browser shows where it goes: a row → `TableRowLink`, a
      chart day → `<Bar shape={<ChartBarLink … />}>`, a button → `<Button asChild><Link …/></Button>`. A row that
      opens a sheet keeps `onClick`.
- [ ] A long action's progress is one toast that turns into the result, survives leaving the page, and stays until
      closed.
