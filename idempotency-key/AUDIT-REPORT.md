# Idempotency Key — Module Review Report

**Date:** 2026-10-22 · **Scope:** `idempotency-key.core`, `.core.postgres-drizzle`, `.core.redis`, `.api`, and its UI in
`ascendra-commons-ui` (`idempotency-key.ui` + the `observability/idempotency` screens) · **Status:** complete — screens
walked as every dev user, drill-downs checked against the list, backend code review with every suspect reproduced on
the sandbox, `EXPLAIN` on every read. How the module works, end to end: [`GUIDE.md`](./GUIDE.md).

The third module through the review `audit-logging` set ([`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md)),
and the second of the small observability modules (after `rate-limiting`; `domain-events` next —
`payment-link-security` and `payment-gateway-adapter` deferred). Nothing in the gaps section is built yet.

## Verdict

The pattern itself was sound before the review — one atomic claim, an ownership token so a late original can't
overwrite its successor, the real status code saved, a saved error replayed as that error — and it still is. What the
review changed is around it: before, the store counted only its failures, so nobody could see what it absorbed; the
saved body (a payer's name and email) travelled with every claim read; and the request path trusted the client's key
— a long enough one turned the payment it protected into a 500. All fixed, along with a list cursor that silently
skipped rows. The gaps are personal data (the body is kept unredacted), cleanup at scale, and the next layer of
product (filters behind every tile, alerting on "ran twice", the configured stale window on screen).

## What's in place

**Claim path**
- `@UseInterceptors(IdempotencyInterceptor)` per endpoint, never global. One atomic `INSERT … ON CONFLICT … RETURNING`
  claims, takes over a stale claim, or loses; `(xmax = 0)` tells a fresh claim from a take-over in the same statement.
- `complete()` guarded on `claim_id` — a late original can't overwrite the new owner's response; that 0-row update is
  counted as "ran twice".
- The handler's real status saved and replayed; a saved error replayed as that error; only a definitive
  `HttpException` saved; the response waits for the save.
- Replays and `409`s counted per claim in memory, added every 10 s — no write on the duplicate's request.
- The key validated (1–255 printable ASCII), the route pattern and a well-formed correlation id recorded.

**Read path (`idempotency-key.api`, behind `idempotency.view`, fails closed without the global guard)**
- Claim lookup, a filtered list (status, scope, route, correlation id, range; keyset-paginated, Rule 4's cursor shape),
  a trace, a health summary and per-route counts over a period.
- The saved body only on its own endpoint, behind `idempotency.view-response`.
- Bad input of every kind is a 400, a missing claim a 404; nothing a caller sends produces a 500.

**Screens (`ascendra-commons-ui`)**
- **Overview** — past hour / 24 hours (claims are kept 24 h), four tiles (Claims, Duplicates absorbed, Reclaimed, Ran
  twice), Duplicates by endpoint, In progress (any age, an orange badge past a minute), the oldest claim kept. The
  Claims tile and every endpoint row open the list on exactly what they counted.
- **Claims** — Recent / In Progress / Advanced Filter (status, route, scope, correlation id, range ≤ 2 days); row
  actions filter by route / scope and copy the key; the trace sheet from a row's correlation id.
- **Claim sheet** — the saved response's code and size, the body on Show (a 403 reads as a note naming the action);
  the correlation id copies — no sheet on a sheet.
- Nav and every screen hidden from / denied to anyone without `idempotency.view` (tenant admins, members); platform
  support sees claims but not bodies.

**Sandbox** — idempotent demo routes (`/demo/payments`, `/demo/invoices/:id/send`, `/demo/refunds` — a saved `422`,
`/demo/payouts` — a gateway timeout left pending); `X-Demo-Delay-Ms`; `staleAfterSeconds = 5` so a take-over and a
"ran twice" happen in seconds; an hourly 24 h cleanup; a support persona without `view-response`. Seed: 400 claims, 56
replays, 14 conflicts, 3 pending, 2 reclaimed, 1 ran twice.

## Fixed during the review

| Defect / change | Where |
|---|---|
| Replays and `409`s — what the pattern absorbs — left no trace; claims had no endpoint. Now counted in memory per claim, added every 10 s; route recorded; per-route counts and a period on the health summary. **Breaking:** `claim(key, scope, context?)`. | commons `493d657` |
| `AuthorizationEnforcedGuard`; list / trace in Rule 4's `{ data, meta }` (**breaking**); bad `limit` / cursor → 400. | commons `26fe0a8` |
| **Personal data:** the saved body came back with every claim read. Now `statusCode` + `responseBytes` only; the body behind `idempotency.view-response` (**breaking**). | commons `664b4b5` |
| Mocks rewritten to the rate-limiting standard — Overview, Claims, Claim and Trace sheets. | commons `626eb5c` |
| **Found wiring the sandbox:** `@UseInterceptors(IdempotencyInterceptor)` in a module other than the importing one failed to boot. `IdempotencyModule` exports the interceptor's dependencies. | commons `ef4519c` |
| **Backend review:** the list cursor carried a JS `Date` (milliseconds) over a microsecond column — page 2 skipped every older claim inside the boundary's millisecond (reproduced: two claims 0.4 ms apart, `limit=1`, page 2 empty). A `|` in a key broke the cursor's split. Now a microsecond ISO string in a JSON cursor; the keyset leads with `created_at <=` so each page's scan starts at the boundary (`EXPLAIN`: Index Cond, not Filter). **Breaking:** the cursor helpers take strings. | commons `ea88650` |
| **Backend review:** `Idempotency-Key` stored as sent — an 8,000-character key was claimed and indexed; a 4,000-character random one exceeded Postgres' btree row limit: a **500 on the payment request** the key protected. Now 1–255 printable ASCII, else 400 before anything is claimed (**breaking**). | commons `b3758fc` |
| **Backend review:** a missing claim or saved response → 200 with an empty body; `?status=bogus` → an empty list reading as "none"; a NUL byte in a path id or filter → 500. Now 404 / 400 / 400 (**breaking**: the 404s). | commons `0e96fc1` |
| Sandbox: vendored and wired (demo routes, support persona, hourly cleanup, seed / simulate); re-vendored with the fixes. | sandbox `393aa78`, `567d66d`, `818be3f`, `a7dec34` |
| The UI: Overview, Claims, Claim and Trace sheets; the claim sheet's correlation id copy-only (no sheet on a sheet); the client follows the 404s. | commons-ui `46cd7aa`, `5f16844` |

## Gaps

### P1 — personal data, security and scale

| Gap | Why it matters | Direction |
|---|---|---|
| **The saved body is personal data, kept unredacted** | Whatever the endpoint returned — a payer's name and email, an invoice's customer — sits in `response_body` for the retention period. The read is now gated, but the data is still there, for anyone with database access and in every backup. | A redaction hook on `complete()` (shared with `audit-logging`'s, "option C" from the PII discussion): the app declares which fields a replay needs, the rest is dropped or hashed before it's stored. A replay of a redacted body must still be a correct response — so it's per endpoint, not global. |
| **Cleanup is one `DELETE` of a day's claims** | At high volume the hourly `DELETE` removes hundreds of thousands of rows in one statement — one long transaction, a WAL burst, bloat on a hot table. | Batched deletes (`… where ctid in (select … limit 10_000)` in a loop), as `rate-limiting`'s `pruneRejections()` does — shipped as a method on the adapter, scheduled by the app. Or partition by day and drop partitions. |
| **Losing duplicate counts is silent** | A failed flush or a full buffer drops counts — logged only. The tiles then under-report what the pattern absorbed, and nothing on screen says so. | Count dropped duplicates (a metric or a row) and show it beside the oldest-claim footnote. Same gap as `rate-limiting`. |

### P2 — product

| Gap | Notes |
|---|---|
| **Three tiles don't link** | Duplicates absorbed, Reclaimed and Ran twice open nothing — the list can't filter to "has duplicates", "was reclaimed" or "ran twice". Add `hasDuplicates` / `reclaimed` / `ranTwice` filters (an index each is cheap — partial on `> 0`), then link the tiles. |
| **No alerting on "ran twice"** | The one *confirmed* duplicate execution — a payment possibly taken twice — is a log line and a red tile. It should page someone: a notification via `notification` when `late_complete_no_op_count` rises. |
| **The stale window isn't on screen** | In progress marks a claim "old" past a fixed 60 s because the API doesn't report `staleAfterSeconds`. Return it from `health`, and the screen can say "reclaimable" — and warn when a route's p99 approaches it. |
| **No application scoping** | One table per store, no `application` column. Two apps sharing a table would share keys: app B could replay app A's response for the same (key, scope). Fine while each app owns its table; add `application` before any table is shared. |
| **No tenant view** | `scope` is opaque, so the read API can't limit a tenant admin to their own claims — both actions are platform-only. If tenants should see their own ("did my customer pay twice?"), the scope resolver would need to expose the tenant it used. |
| **No trend on the tiles** (AUI-014) | `health` and `routes` take only `since`; a "vs. previous period" needs `until`. |
| **A denied user sees three 403s on the Overview** | Tiles and both lists each report it (same as `rate-limiting`). Only reachable by URL. |
| **The list's footer counts loaded rows** | "1–10 of 50" is the page fetched so far, not the total — ascendra-ui's cursor footer, shared with every module. |

### P3 — later / nice to have

- Model 2 (`RedisIdempotencyStore`) is a stub — build when the table's volume is a real concern.
- `responseBytes` is the size of the `jsonb` rendered as text, computed per list row (`octet_length(response_body::text)`)
  — not the wire size, and it serializes every body on a list page. Store the size at `complete()`.
- A scope literally named `trace`, `health` or `routes` can't be looked up by path (the static routes match first) —
  the list's `scope` filter still finds it.
- No real-database tests in CI — the atomic claim under concurrency, `xmax`, the batched counter `UPDATE`, microsecond
  cursors and the plans were verified on the sandbox's Postgres 16 by hand.
- A late complete is counted with an `UPDATE` per event (rare by nature; the duplicate path's rule doesn't apply).
- Clickable rows are `<tr onClick>`, not keyboard-reachable (as audit and rate-limiting).
- Sandbox data ages out: the seed is gone 24 h after it runs — re-seed before a review.

## Suggested order

1. The redaction hook — the one P1 that is about data already stored; design it with `audit-logging`'s.
2. The three tile filters and `staleAfterSeconds` in `health` — small, and they finish the Overview.
3. Batched cleanup, shipped as an adapter method like `pruneRejections()`.
4. Alerting on "ran twice", once `notification` is in the sandbox.
5. `domain-events`, the next module.

## Standards this review set for future modules

- **A keyset cursor carries the sort key at the column's precision.** A `timestamptz` from `now()` has microseconds; a
  JS `Date` has milliseconds. Serialize the boundary from SQL (`to_char(… 'US')`) or sort on a value the app wrote.
  `audit-logging` is safe (its timestamps come from JS); check every new module.
- **A cursor is JSON, not a delimited string** — any part the caller chose (a key, a scope) can hold the delimiter.
- **The keyset condition leads with the indexed column** (`ts <= b and (ts < b or tie < t)`) — the `OR` alone is a
  filter, scanned from the top on every page.
- **A header that becomes a key is validated before it's used** — length and charset, with a 400 that says what's
  allowed. A primary-key column has a hard size limit; past it the request itself is a 500.
- **A NUL byte in any text param is a 400.** Postgres `text` can't hold one and fails with an encoding error.
  `rate-limiting` still answers 500 for `GET /rate-limits/rejections/trace/%00` and `?route=%00` — fix it there next.
- **A record that isn't there is a 404, never a 200 with an empty body** — and an unknown enum value is a 400, never an
  empty list that reads as "none".
- **A sheet never opens a sheet** — an id inside a sheet copies; drill-downs start from a page.
- The backend conventions are otherwise unchanged from [`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md);
  this module passes every item that applies (no tenant scope, no application, no CSV).
