# Notification — Module Review Report

**Date:** 2026-10-26 · **Scope:** `notification.core`, `.core.static`, `.core.database`, `.core.database.postgres-drizzle`,
`.api`, and its UI in `ascendra-commons-ui` (`notification.ui` + the `/notifications` console) · **Status:** complete —
code review of every package (stage 1, all findings approved and built), the sandbox wired with every option on and
seeded through the module's own entry points, the raw API probed (48 bad inputs and permission checks, every one a
4xx with a message, none a 500), the mock rewritten and approved, every screen built and walked as each dev user,
`EXPLAIN` on every read. How the module works, end to end: [`GUIDE.md`](./GUIDE.md).

The sixth module through the review `audit-logging` set ([`../MODULE-GUIDE-TEMPLATE.md`](../MODULE-GUIDE-TEMPLATE.md)),
after `authorization`, and the first of the two product modules (`file-storage` next). Nothing in the gaps section is
built yet.

## Verdict

The pattern was sound and is unchanged: feature code calls `Notifier.notify()`, which routes one type to its channels,
renders each channel's template and hands it to that channel's sender — never throwing, logging every attempt. What sat
around it wasn't ready for a product: the senders were stubs with no way to plug in a real one; a tenant admin could
read another tenant's stored messages and test-send to any address; reads leaked across tenants; bad input was a 500;
the delivery log wrote one row per send on the sender's own path; there was no retention, no suppression of bounced
addresses, no way to find a guest's sends, no retry, no preferences and no in-app channel. All built. The real gaps
now are outside the module's own logic: **no real provider sender ships** (each app writes its SES / Twilio / Meta
sender), **nothing receives provider callbacks** (the app writes the webhook that calls `updateDeliveryStatus`), and a
send that fails before any channel is tried (the type routed nowhere, the config store down) **never reaches the
delivery log**, so the console can't count it.

## What's in place

**Send path (`notification.core`)**
- `Notifier.notify()` never throws: route → per channel (opted out? suppressed? → the sender) in parallel → aggregate
  `sent` / `partial` / `failed` / `skipped` → record each attempt best-effort. `notifyCritical()` throws on failure.
- `forRoot({ senders })` — a real sender per channel, built inside the module (injects config, the contact resolver,
  anything in `imports`); stubs log a redacted line only.
- Declared types (`forRoot({ types })`): description, audience, variables with samples, `required`.
- Keyed hashes of guests' addresses (`recipientHashKey`) — searchable, never stored; the suppression list; dedupe keys
  (`notify({ dedupeKey })` sends once per key); per-user preferences (most specific rule wins, `required` always on);
  the `in_app` channel into a per-user inbox; a retry of one channel (`channels`, `retryOf`); test sends marked.
- A failed send keeps its variables (no body), so a retry can rebuild it.

**Store (`notification.core.database.postgres-drizzle`)**
- Config (routes, templates, credentials) with a platform default credential and opt-in tenant fallback; a config
  cache emptied on every API write.
- Buffered delivery recorder (2 s / 1,000 rows, bounded at 50,000, normalizes each row); `flush()` for an answer that
  links to its row; `updateDeliveryStatus` (the webhook side) flushes first and can suppress.
- Retention: clear stored content (30 d in the sandbox), prune rows (90 d), inbox items, expired dedupe keys.
- Twelve numbered migrations; an index for every read the console makes.

**Read and admin API (`notification.api`, fails closed without the global guard)**
- Delivery log (`{ data, meta }`, JSON keyset cursor at µs precision; filters: type, channel, status — one or several —
  reason code, tenant, user, guest address, recipient key, correlation id, test, range), one delivery, its content
  (`notification.view_content`, every read audited), retry (`notification.retry`, once, audited).
- Stats per calendar day in the viewer's zone (by channel, type, day with failures, reason); volume (platform only);
  coverage gaps (every tenant a default route reaches); types with their routes, templates and gaps.
- Config writes validated against the declared types, audited with before and after; credential verify; preview;
  test send (a tenant admin: itself or a colleague; marked; left out of the stats).
- Suppressions (visible to every tenant they affect, removable by the one whose bounce filed them, or the platform);
  the user's own preferences and inbox.
- Every caller's mistake a 400 naming the field; another tenant's row the same 404 as a missing one.

**Screens (`ascendra-commons-ui`, its own shell at `/notifications`)**
- **Overview** — 24 h / 7 d / 30 d, a platform admin's tenant; tiles (sends, reached, failed, skipped, config gaps),
  by channel, why sends failed, by type, configuration health, sends per day. Every count opens Deliveries on exactly
  what it counted.
- **Deliveries** and the **delivery sheet** — the timeline with the retry chain, the message on request, Retry with a
  confirm that warns when the failure wasn't transient, a suppressed send's entry, everything to the recipient.
- **Notification types**, the **type page** (routing, templates, variables, coverage), the **template editor**
  (palette, live preview, an unknown variable blocks Save) and **test send**.
- **Provider accounts** (tenants × channels, verify, set, remove) and **Suppressions**.
- **Volume & Retention** (platform admins).
- Everyone's: the **bell** in the app's top bar, **My inbox**, **My notifications**.

**Sandbox** — every `forRoot` option on; eight declared types; fake SES / Twilio / Meta senders with `verify` and
provider ids; ~3.5k deliveries over 90 days written through the real recorder, with one story per screen: a revoked
SMS key (Globex), a route with no template (Meridian), a hard-bounced guest suppressed across tenants, a white-labelled
template and email-only reminders (Acme), a user opted out of SMS, a tenantless job alert, a leftover route for an
undeclared type.

## Fixed during the review

Stage 2 (backend, from the stage-1 review) — security and correctness: `d0d91b5` every controller fails closed without
the global guard · `4611992` JSON cursor at µs precision, a foreign one a 400 · `0a2f61a`! bad input a 400, `{ data,
meta }` · `e0bc69e` content scoped like the row · `c3d676f` config reads tenant-scoped · `0a9e418`! config edits
validated, deletes keyed in the path, 404 when absent, audit carries before · `d9ee9e0`! `notification.view_content`,
content reads audited · `6974b67`! test send limited to the sender or its tenant, marked · `021964d` stub senders log
a redacted line · `866f2d4` config cache emptied on write.
Scale and data: `7c2a4b9` buffered recorder · `9b0255c` retention · `29e54f6`! whole days in the viewer's zone, volume
read · `b30a35d` read indexes.
Product: `43a2717` real senders per channel · `2410097`! platform credential + fallback · `0a06456` declared types ·
`bad0328` coverage per tenant · `d118361` keyed recipient hashes · `b9a0e5e`! suppression list · `a62820a` dedupe ·
`c64bbbb` preferences · `5e69e63`! in-app channel · `d74ef76` retry · `d976ae3` credential verify.

Found while seeding and building the console: `cf100fe` a failed send kept nothing to retry from · `cc8184c` stats by
reason · `dd9040d`! a tenant couldn't see a suppression another tenant's bounce filed, though it skipped its sends ·
`d1a1358` user recipients named · `1b4f0cf`! a delivery names its retry, and a second retry is refused (it resent the
message) · `7aac4f0` a retry's row was invisible for up to 2 s, so the retry-once check could pass twice · `9f31cad`!
per-day failures · `1a4b9fa` filter by reason · `b217b06` types carry `required` · `80d7002` several statuses,
suppressions by recipient.

## Gaps

### P1 — before a product sends real notifications

- **No real provider senders.** Each app writes its own (`forRoot({ senders })`). *Direction:* ship
  `notification.email.ses`, `notification.sms.twilio`, `notification.whatsapp.meta` as optional packages, each with
  `verify` and `providerMessageId`.
- **No provider webhook.** Delivered / bounced / complaint callbacks only arrive if the app writes the controller that
  calls `updateDeliveryStatus`; without it nothing is ever `delivered` and nothing is suppressed. *Direction:* a
  `notification.api` webhook controller per provider package, signature-checked.
- **A send that fails before any channel is tried isn't logged** — no route (`no_channel_configured`), a config store
  that throws, a retry of an unrouted channel. *Direction:* record one channel-less attempt so the overview counts it.
- **Content-read auditing depends on wiring.** Without `auditEmitterToken`, `notification.content_viewed` and config
  edits go nowhere, silently. *Direction:* warn at boot (or refuse) when `view_content` is served without an emitter.

### P2 — product

- **Inbox items can't link** to what they're about (the mock's "opens what it's about"). *Direction:* an optional
  `link` on an in-app send, stored with the item.
- **Verify results aren't kept** — the accounts screen forgets "checked 1 min ago" on reload. *Direction:* store the
  last check (when, ok, detail) on the credential row.
- **My notifications lists every routed type** — a staff user sees payer types. *Direction:* let a type declare who it
  can reach, or let the app's contact resolver say which audiences a user belongs to.
- **Test send to a colleague takes a typed user id.** *Direction:* a user lookup through the app's contact resolver.
- **Who retried isn't on the row** — only in the audit log. *Direction:* `retried_by_actor` on the retry row.
- **Per-gap failure counts** on the type page ("14 sends failed since 20 Oct") — a link stands in.

### P3 — later / nice to have

- The retry-once check has a millisecond window between the send and its flush; a unique partial index on
  `retry_of` would close it (the insert is best-effort, so the second message would still go out — needs a claim
  before the send).
- The bell polls every 30 s — no push.
- Phone layouts: the accounts and preferences grids scroll inside their card.
- Rotating `recipientHashKey` makes older rows unsearchable by address (documented, by design).

## Suggested order

1. Webhook controller + the not-routed attempt row (both make the numbers true).
2. One real sender package (email first), with `verify`.
3. Boot-time check for the audit emitter.
4. Inbox links, stored verify results, audience per user — then the rest of P2.

## Standards this review set for future modules

- **An answer that links to a row is written before it answers** — a buffered writer exposes `flush()`, and the API
  calls it (retry, test send). A check against a row that may still be buffered isn't a check.
- **A once-only action records its link both ways** (`retryOf` on the new row, `retriedBy` read back on the old) and
  refuses the second attempt with a 400 naming the first.
- **Every count on a screen has a filter that reproduces it exactly** — here status lists and reason codes were added
  for that alone. If a count can't be reproduced, it doesn't link.
- **Something that can't be stored can still be searched**: a keyed hash (secret from the environment) of a guest's
  address, never the address.
- **A list a tenant can't fully own still shows it what affects it** (suppressions), with `removable` saying which.
