# Step 1 — audit-logging

**Goal:** know audit-logging end to end: how it's set up in an app, what happens on every write and every read, how
its UI talks to it, and which parts you can swap. Then wire it into your own lab app, backend and UI, from scratch.

**Before you start:** step 0 reviewed.
**Deliverables** go in `commons-lab/notes/01-audit-logging/` and in `commons-lab/api` and `commons-lab/web`.

**The module in one line:** feature code raises an `AuditRecordRaised` event, a shipped listener saves it, and an
optional API plus UI show it.

| Package | Repo / path |
|---|---|
| `audit-logging.core` | `ascendra-commons/audit-logging/audit-logging.core/` |
| `audit-logging.core.postgres-drizzle` | `ascendra-commons/audit-logging/audit-logging.core.postgres-drizzle/` |
| `audit-logging.api` | `ascendra-commons/audit-logging/audit-logging.api/` |
| `audit-logging.ui` | `ascendra-commons-ui/packages/audit-logging.ui/` |
| Audit screens | `ascendra-commons-ui/testbed/app/observability/audit/` |
| Sandbox wiring | `ascendra-commons-sandbox/src/modules/commons/audit-logging.ts`, `audit-catalog.ts` |

---

## 1.1 Read

- [ ] `audit-logging/README.md`.
- [ ] `audit-logging/GUIDE.md` — all of it. Open every file it names as you go.
- [ ] `audit-logging/AUDIT-REPORT.md`.
- [ ] The README in each of the three packages.
- [ ] `audit-logging.api/mocks.html` in a browser — the design the screens were built from.
- [ ] `ascendra-commons-ui/packages/audit-logging.ui/README.md`.

**Done when:** `notes/01-audit-logging/glossary.md` defines, one line each: audit record, entity, action, actor,
tenant, application, correlation id, `AUDIT_EVENT_NAME`, `emitCritical`, `@OnCriticalEvent`, write port, read port,
keyset cursor, catalog.

## 1.2 Use the API (sandbox)

Sandbox running, history seeded (`npm run db:reset`).

- [ ] Get a token for each persona: platform admin, platform support, `admin@acme.test`, `member@acme.test`.
- [ ] Before each call, **write down what you expect** (status code, and roughly what data). Then call it.
- [ ] Call every endpoint in GUIDE §7 at least once.
- [ ] As `admin@acme.test`, send `?tenantId=tenant_globex`. Explain what you get back and why.
- [ ] Take one record's `correlationId` and call `/audit/trace/:correlationId`.
- [ ] Download `/audit/events.csv` and read the `X-Export-*` headers.
- [ ] Send bad input: a bad date, `limit=9999`, a made-up cursor, a non-UUID record id. Record the status codes.

**Done when:** `notes/01-audit-logging/api-calls.md` has a table — endpoint × persona → expected / actual status,
with a one-line reason for each 401, 403, 400 and 404. Any row where expected ≠ actual has an explanation.

## 1.3 Use the UI (testbed)

- [ ] Open the Audit Overview, the Audit Log list, and Retention & Volume.
- [ ] On the list: run Recent and Advanced Filter, use each row drill-down, open the record, actor, entity-history
      and trace sheets, and export a CSV.
- [ ] Keep the browser DevTools Network tab open. Note which API call each screen and action makes.
- [ ] Repeat as a tenant admin. Note what changes.

**Done when:** `notes/01-audit-logging/ui-map.md` has a table — screen or action → API endpoint → the `auditApi`
function in `audit-logging.ui/api/audit-api.client.ts` that calls it.

## 1.4 Read the code and the tests

- [ ] In `ascendra-commons`, run only this module's tests: `npx vitest run audit-logging`. All pass.
- [ ] For every file in GUIDE §13 (file map), write one line: what it does.
- [ ] Pick 3 spec files. For each, write what behaviour it proves and which test would fail if that behaviour broke.
- [ ] Find the test that boots a real NestJS module (`Test.createTestingModule`). Explain what kind of bug only it
      can catch.

**Done when:** `notes/01-audit-logging/code-map.md` holds all of the above.

## 1.5 The flow walkthrough — main deliverable

Write `notes/01-audit-logging/flow.md` in your own words, with a `file:line` reference at every step. Use the GUIDE
as a source, but follow the real code — don't copy the GUIDE.

- [ ] **Startup.** What each `forRoot` registers, which token points to which class, and how the
      `AUDIT_EVENT_REPOSITORY` token ends up as `PostgresAuditEventRepository`. Include a diagram.
- [ ] **Write path.** From `emitCritical(...)` in feature code to the `INSERT`. Where the correlation id comes from.
      Where `application` comes from.
- [ ] **Failure path.** The database is down during an audit write. What happens, step by step, back to the caller?
- [ ] **Read path.** One `GET /audit/events?actor=…` from the browser to SQL and back: proxy, middleware, both
      guards, controller, service (tenant scoping), reader (application scope, keyset cursor, `limit + 1`).
- [ ] **UI path.** How the list screen turns "next batch" into a cursor (`createCursorQueryFn`).
- [ ] **Security.** For each row of GUIDE §8: which file enforces it.

**Done when:** the reviewer can follow any step to the line of code you name.

## 1.6 Wire it into your lab API

Build `commons-lab/api`: a plain NestJS app with Postgres (Docker) and Drizzle. **Keep the app tiny:**

- One table, `invoice` (`id`, `tenant_id`, `amount`, `status`).
- Three endpoints: `POST /invoices`, `POST /invoices/:id/pay`, `GET /invoices/:id`.
- Fake sign-in: a guard that reads an `x-actor` header and sets `request.actor = { id, persona, tenantId }` from a
  hard-coded list of 3 users (platform admin, tenant admin, member).

Then wire audit-logging, following the README "Integrating into a project" and GUIDE §4:

- [ ] `node ../../ascendra-commons/ascendra-commons.js init`, then `add` the packages you need, with
      `--from ../../ascendra-commons`. Write down why you picked each package.
- [ ] Install the npm packages `add` reports as missing.
- [ ] Apply the delivered migrations. `commons_audit_event` exists.
- [ ] `src/modules/commons/`: one file per module (`domain-events.ts`, `authorization.ts`, `audit-logging.ts`), and a
      `CommonsModule` importing them.
- [ ] Authorization: use `authorization.core.static-map` (Model 1) with a persona map that gives `audit.view` only to
      the two admins. Register `AuthorizationGuard` globally, **after** your fake sign-in guard.
- [ ] `CorrelationIdMiddleware` on every route.
- [ ] Your own audit catalog (`invoice`: `created`, `paid`).
- [ ] Creating an invoice and paying it each raise an `AuditRecordRaised` (with `before` / `after` for the payment).
- [ ] `node ascendra-commons.js status` is clean.

**Done when:**

- [ ] One script, `notes/01-audit-logging/demo.sh`, does: create an invoice → pay it → read
      `/audit/entities/invoice/:id/history` → read `/audit/trace/:correlationId` for the payment request. Output saved
      in `demo-output.txt`.
- [ ] As the member, every `/audit/*` call is 403. As the tenant admin, you only see your own tenant.
- [ ] Nothing under `src/ascendra-commons/` is edited (`status` proves it).

## 1.7 The seams — what you can swap and when

audit-logging has **no Model 1 / Model 2 split** (README explains why). Its flexibility is in its ports and in the
wiring the host app chooses. Do each exercise on its own branch in your lab, then explain it.

- [ ] **Why no Model 1/2?** Explain in 3–5 sentences. Compare with `authorization`
      (`static-map` vs `permission-table`) — what makes that module need two models and this one not?
- [ ] **Swap the write adapter.** Write your own `InMemoryAuditEventRepository` (or one that logs to the console) in
      your **app's** code. Bind it through `auditEventRepositoryToken`. No commons file changes. Show records still
      flow. Then switch back.
- [ ] **Failure propagates.** Make your repository throw. Show that `POST /invoices/:id/pay` fails. Then change your
      feature code to use `emit()` instead of `emitCritical()` and show the failure is swallowed. Explain why commons
      insists on `emitCritical`.
- [ ] **Transaction or not.** Pay an invoice inside a database transaction that rolls back **after** the audit
      event. With a plain pool executor: show the audit row survives. Then bind the executor to the transaction: show
      both roll back together. Explain when each behaviour is acceptable.
- [ ] **Who counts as platform admin.** Override `isPlatformAdmin` in `AuditApiModule.forRoot` (e.g. by persona
      instead of `tenantId === null`). Show the effect.
- [ ] **Another stack.** Explain, without building it, what a project on another database (or one sending audit to an
      external SIEM) would write, and which packages it would keep unchanged.

**Done when:** `notes/01-audit-logging/seams.md` has, for each exercise: what you changed, what you saw (output or
screenshot), and when a real project would choose each option. Each branch is pushed.

## 1.8 Wire the UI into your lab web

Build `commons-lab/web`: a Next.js app on `ascendra-ui`, pointing at your lab API. **No pages of its own** except a
sign-in stand-in.

- [ ] Set up `ascendra-ui` the way `ascendra-commons-ui/testbed` does (compare `testbed/package.json`,
      `testbed/providers/`, `next.config.ts`).
- [ ] Copy `audit-logging.ui` and `shared/` into `web/ascendra-commons-ui/`, unchanged, as `packages/README.md`
      ("What a consumer receives") describes.
- [ ] Copy the audit screens from `testbed/app/observability/audit/` into your app's routes.
- [ ] Mount the module's `nav.ts` in your app's navigation.
- [ ] Point the API calls at your lab API (a Next rewrite, as the testbed does), and send your `x-actor` header or a
      token.

**Done when:**

- [ ] The Overview and the Audit Log list show **your lab's** invoice records.
- [ ] Opening a record shows the `status` diff from your payment.
- [ ] `notes/01-audit-logging/ui-wiring.md` lists every file you copied, and every change you had to make in your own
      app to make it work (not in the copied files).

## 1.9 Findings — report only

- [ ] Go through `AUDIT-REPORT.md` "Gaps". Pick the 3 you think matter most for Ascendra Pay, and say why.
- [ ] Add anything **you** found: a bug, a doc that doesn't match the code, a confusing name, a missing test.

**Done when:** `notes/01-audit-logging/findings.md` follows the format in the [README](README.md#the-findings-file).
Zero findings is allowed, but say what you checked.

---

## Hand-in

- [ ] All notes committed and pushed; the lab API and web run from their READMEs on a clean clone.
- [ ] A short `notes/01-audit-logging/summary.md`: what was hardest, what you'd explain differently to the next
      person, and how long each section took.
- [ ] Ask for the step 1 review: a 45–60 minute session — walkthrough, questions, and one live debugging exercise.
