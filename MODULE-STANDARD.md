# Module Standard — ascendra-commons

## Document Control

| Version | Date | Reason |
|---------|------|--------|
| 1.0 | 2026-09-04 | First cut. Written after `authorization`, `notification`, and `domain-events` each independently grew an `application`/`tenantId` seam and a Model 1/Model 2 split, on their own reasoning, in their own words. This document makes the reasoning explicit and checkable across all seven modules instead of re-derived per module. |

---

## 1. Purpose

`ascendra-commons` is copy-distributed (see `module-packaging-pattern.md` in
`ascendra-pay-002`, and this repo's own root `README.md`) — a source folder per
pattern, copied verbatim into each consuming project. That model only stays
coherent if every module makes the same set of decisions the same way. This
document is the checklist: eleven dimensions every module in this repo should
either satisfy or explicitly opt out of, with a stated reason. "Opt out, with a
reason" is a pass. Silence is not — the point is that every dimension was
*considered*, not that every module looks identical.

Use it two ways: as a design checklist while building a new module, and as an
audit checklist against the six that already exist.

---

## 1b. Package roles (added 2026-09-07, applied to `authorization`, `notification`, `audit-logging`, `background-jobs`)

A module that has grown a real Model 1 / Model 2 split, more than one plausible
Model 2 stack, and an admin/observability surface is no longer one folder. It is
a **container folder** of dot-named **packages**, each an independent copy unit
(own `index.ts`, `README.md`, specs, real-DI boot test):

| Package | Role |
|---|---|
| `<module>.core` | The contract only — interfaces, the cross-cutting mechanism (guard/decorators/compute helpers), `forRoot()` as pure token wiring, a `Missing*` throwing stub. **No working implementation.** |
| `<module>.core.<capability>` | A Model 1-style single implementation (e.g. `authorization.core.static-map`). |
| `<module>.core.<family>` | A Model 2 family — stack-agnostic: ports a stack adapter implements, DTOs, pure rules, the port-based implementation. No SQL. May be thin (`notification.core.database` is just a cache util, a cursor helper, and the admin ports/DTOs — notification's DB story has no shared *algorithm* the way `authorization.core.permission-table` does) — that's still worth its own package so a second stack adapter shares it. |
| `<module>.core.<family>.<db>-<orm>` | One stack (e.g. `…permission-table.postgres-drizzle`) — schema, migration, repositories, seed **only**. Sub-folders by job allowed here; `index.ts` stays the sole public surface and exports modules, not classes. |
| `<module>.api` | Opt-in HTTP controllers + thin `.api` services + request DTOs, over the family **ports**. Never imports a stack adapter — wired to one at the vertical via tokens. |
| `<module>.ui` | Reserved — React, ships from `ascendra-commons-ui`, not here. |

**Dependency direction is one-way toward `.core`.** A vendored module that
depends on another (`file-storage` → `authorization`) depends on its **`.core`
package only** — never a `.static-map`, `.<family>`, `.<stack>`, or `.api`. When
the depended-on module is *not* split (`audit-logging.core` → `domain-events`),
the dependency targets the whole module; revisit if it splits.

**Not every module uses every row.** `audit-logging` and `background-jobs`
(2026-09-07) have **no Model 1 / Model 2 config split** — one model behind a
port — so no `.core.<capability>`, no `.core.<family>`: just `.core` /
`.core.postgres-drizzle` / `.api`. The rows are a menu, not a checklist. What
still applies:
- **A stack-coupled class in `.core` moves to the adapter.** `background-jobs`
  shipped `PostgresAdvisoryLock` as `.core`'s *default* lock; the split moved it
  to `background-jobs.core.postgres-drizzle/lock/` and made `advisoryLockToken`
  a required `forRoot()` field (like every other impl token). `.core` keeps only
  the `AdvisoryLock` interface.
- **An observability read needs a port even if there was only a concrete class.**
  `background-jobs` had a bare `PostgresJobObservabilityService`; the split added
  `JobObservabilityPort` in `.core` so `.api` depends on the port.
- **`.api` scope follows the module.** `audit-logging.api` is read-only (records
  are write-once). `background-jobs.api` is reads + one action (`POST /jobs/:name/run`
  via `JobTrigger`) and has **no tenant scoping** (`background-jobs` has no
  `tenantId` anywhere). Both take an optional audit-emitter token only where
  something mutates.

**Naming:** container folder per module; child folder names repeat the module
prefix (`authorization.core`, not `core`) so each is self-identifying when
copied; name by capability (`static-map`, `permission-table`), not slot
(`model1`/`model2`); stack is `<db>-<orm>`.

**Don't split preemptively.** A module with a prose-only Model 2 and no admin
surface stays one folder (dimension 6). The split is earned by the same signals
a real stub is (dimension 6) plus a concrete second consumer of the family ports
(the `.api` package is one).

## 2. The eleven dimensions

### 1. Export boundary

One `index.ts` barrel per **package** (see 1b) — for a single-folder module
that's the module; for a split one it's each dot-named package. Anything not
re-exported through it is invisible outside that package — feature code, other
modules, and *sibling packages* import only `from '<sibling>/index'` (or the
path-aliased equivalent), never a file inside. This is what makes the
copy-distribution model, the Model 1 → Model 2 swap, and the family/stack split
all low-friction: nothing outside a package has ever depended on anything but its
exported surface.

### 2. Packaging & distribution

Own top-level folder in this repo. Copied verbatim into the consumer's
`src/ascendra-commons/{pattern}/` — no build step, no registry, same folder
name. If the module depends on another vendored module (`audit-logging` on
`domain-events`, `file-storage` on `authorization`), that dependency is stated
explicitly in the README's "Consuming this module" section, since the consumer
must copy both.

### 3. `forRoot()` config discipline

Dynamic-module config uses Symbol injection tokens, never string literals — a
typo becomes a compile error, not a silently unbound provider. Required config
(no sensible default exists) throws loudly if omitted, rather than guessing or
silently no-oping. A knob with a genuinely sensible default (like transport
defaulting to `'in-process'`) may default; nothing else should.

### 4. `applicationId`

Threaded **only if** the module has a plausible shared-destination surface —
somewhere multiple Ascendra applications' output could land in the same place
(a message broker, a shared log/analytics sink). `domain-events` is the
canonical case: `DOMAIN_EVENTS_APPLICATION_ID` is defined there for its broker
path, and a cross-cutting consumer that only *opts into* tagging its output by
application `@Inject()`s that same token rather than declaring its own —
provided the consumer supplied `application` to `DomainEventsModule.forRoot()`.
A module that *always* needs the value (not opt-in) instead takes it through
its own `forRoot()` and binds its own module-scoped token
(`audit-logging`'s Postgres adapter does this with `AUDIT_APPLICATION_ID`), so
it works even when the consumer never passes `application` to `domain-events`;
`notification` reached the same conclusion from the other direction (see
`MODULE-STANDARD-AUDIT.md`, 2026-09-05 — its exported token was removed once
`forRoot()` couldn't bind it). Per-module token names are module-prefixed
either way.

**Required only where actually consumed, not blanket-required by the whole
module.** `domain-events` itself got this wrong on the first pass:
`application` was made a required `forRoot()` field under *both* transports,
even though only the broker path (`BrokerDomainEventEmitter`) reads it —
`InProcessDomainEventEmitter` never does. The fix was to make it optional
overall and required only under `transport: 'broker'`, so the common,
real-today path pays zero cost for a concern that has no consumer there yet.
The general rule: a required config field earns its requiredness from an
actual reader, not from "might be useful somewhere in this module eventually."

Modules with no such surface (pure intra-app concerns — `authorization`,
`notification`, `idempotency-key`) are marked **N/A**, with that one-line
reason, not silently skipped.

**Passive schema metadata is a different, cheaper case than an active
parameter — don't conflate the two.** A module can be correctly N/A for
`applicationId` as a *query parameter* (nothing to disambiguate within one
app's own database) while still benefiting from `application_id` as a
*passive column* on any reference schema it documents — populated via a
constant or a `DEFAULT` at write time, never read or filtered on. This is
free specifically because it's added before the table exists (a brand-new
`CREATE TABLE` costs nothing extra for one more column); the same column
added after real rows exist is a genuine backfill migration. The two are not
the same request: an active parameter with no reader repeats the
`domain-events` mistake above; a passive column with no reader is closer to
`created_at` — cheap insurance against a future data consolidation (analytics,
a reporting export) rather than a live thing every call site must carry.
`audit-logging`'s adapter does this (`application` column, stamped on insert,
never read — `find()` isn't built).

**One step further, when a module's rows are conceptually cross-product:** an
*active* `application` filter (`WHERE application = $1` on every read, from
`forRoot({ application })`) is acceptable even though it repeats the same
constant value within one app's own database — because it costs nothing there
and keeps the tables correct if that config is ever consolidated. This is not
the `domain-events` mistake: the parameter *has* a reader (every query), it
just resolves to one value per deployment. Reserve it for rows that genuinely
collide across products — `notification`'s adapter does this (a `notificationType`
like `invoice.sent` that both `ascendra-pay` and `ascendra-erp` define) — not
for project-specific rows like `authorization`'s role catalog.

### 5. `tenantId`

Threaded on the module's main request/subject object (mirroring
`Actor.tenantId`) **if** the module's behavior could plausibly vary per
tenant — even if the Model 1 implementation ignores it and only a future
database-backed Model 2 would actually branch on it. This is a cheap,
additive, non-breaking seam to add now; retrofitting it later touches every
call site.

Modules where tenant variance doesn't make sense are marked **N/A**, with a
reason (e.g. a lock scope or idempotency key is already caller-supplied and
opaque to the module; there's nothing tenant-shaped for the module itself to
branch on).

### 6. Model 1 / Model 2 split

Every README states, explicitly: what Model 1 is (what's actually shipped),
what a plausible Model 2 looks like, and the *concrete* trigger condition for
building it — never "eventually" or "when we scale."

**Default: prose only, no stub class, no token, no seam in code.** A real
stub (interface + placeholder implementation that throws, wired through
`forRoot()`) is the exception, earned by a *named, near-term* signal — the
same bar `DOMAIN_EVENTS_APPLICATION_ID` was held to. Seaming
every module preemptively is the noise this standard exists to prevent, not
create.

**Once both models are real, they become separate packages (1b), not classes
in one folder.** `authorization` (2026-09-07) is the worked example: `.core`
ships only the `Authorizer` interface + a `MissingAuthorizer` throwing stub;
Model 1 is `authorization.core.static-map`; Model 2 is the
`authorization.core.permission-table` family + a per-stack adapter. `forRoot()`
in `.core` stops importing any concrete model — it is pure token wiring, and
both models wire through it identically (`authorizerToken` + the module that
provides it).

### 7. Persistence ownership

Where a module needs a database: the *table schema* may be generic enough to
be shared/exported from this library, but the database *instance* and
*connection* are always owned and constructed by the consuming project — this
library never centralizes state across consumers. Acceptable to duplicate only
small, low-write-volume config/metadata (channel routing, templates, role
definitions) — never core transactional data. Per-consumer migration drift and
"no automatic fix propagation" are accepted costs of this tradeoff (see
`module-packaging-pattern.md` §4), not bugs to solve by centralizing.

**Table names are `commons_<module>_<table>`.** Every table a vendored module
ships is prefixed `commons_` so a consumer can tell at a glance which tables
came from `ascendra-commons` and keep them together
(`commons_authz_role`, `commons_notification_template`, `commons_audit_event`,
`commons_idempotency_key`, `commons_jobs_job_run`, `commons_jobs_lock`, …).
Indexes and constraints carry the same prefix. The Drizzle `pgTable` *export
identifiers* keep their short names (`authzRole`, `jobRunTable`) — only the SQL
name strings are prefixed.

**N/A here comes in two different strengths — say which.** A module whose
Model 1 *and* every plausible Model 2 have no database at all (`authorization`'s
`applicationId`, by analogy) is N/A permanently. A module whose *current*
Model 1 has no persistence but whose already-documented Model 2 will (e.g.
`authorization`: `StaticRoleMapAuthorizer` touches no DB today, but
`PermissionTableAuthorizer` will need a `roles`/`role_permissions`/`user_roles`
shape once built) is N/A *for now* — the rule this dimension states still has
to be honored when that Model 2 lands, and the audit should say so explicitly
rather than let a flat "N/A" read as "this module has no persistence story at
all."

### 8. UI / frontend contract

Two different questions, not one — score them separately:

- **End-user UI contract.** Does the module have a hide/show, enable/disable,
  or per-record availability concern reaching the app a *tenant's own user*
  sees? If so, the contract is documented in the module's own README (the way
  `authorization`'s `computeSessionSnapshot`/`computeActionAvailability` are),
  even though no frontend counterpart library (`ascendra-commons-ui`) exists
  yet.
- **Administration UI.** Does the module need a management surface for
  *configuring itself* — defining roles, editing templates, browsing records?
  This is a separate concern from the first, and a module can score
  differently on each.

Modules with no user-facing surface at all on either question
(`domain-events`, `background-jobs`, `idempotency-key`) are marked **N/A** on
both.

**The "no shipped controllers" rule is relaxed for a `.api` package (1b).**
Originally this repo shipped services + DTOs only and left the HTTP controller
to the consumer. That still holds for a single-folder module. But once a module
has admin/observability **ports** (in a `.core.<family>`, or just in `.core`
when there's no family — `audit-logging`), a `.api` package may ship generic
NestJS controllers against those ports — they carry no app-specific logic, are
gated by the consumer's own `Authorizer` via `@RequiresAction`, and the
actor-scoped rules (tenant/role ceiling, or "force the query to the actor's
tenant") live in a thin `.api` service between controller and port.
`authorization.api`, `notification.api`, `audit-logging.api` and
`background-jobs.api` (2026-09-07) are the first four — `notification.api` also
ships `POST /notifications/test-send` (calls `Notifier`), `background-jobs.api`
ships `POST /jobs/:name/run` (calls `JobTrigger`); `audit-logging.api` is
read-only. A generic `CurrentActor` param decorator was promoted to
`authorization.core` for all of them to share. React stays out — that's
`ascendra-commons-ui`.

### 9. Naming convention

Every string key a module hands to a consumer to define — action names, event
names, notification types — uses `resource.verb` dot-notation
(`invoice.void`, `payment.confirmed`). Stated once, here, as a cross-module
standard; a module's own README doesn't need to re-derive it, only follow it
and note any place it doesn't (yet) apply.

### 10. Testing bar

One `.spec.ts` per file, covering the unit's own documented behavior. At least
one test per module that boots a real `Test.createTestingModule()` and
resolves the dependency graph for real — wiring bugs (a missing binding, a
`useFactory` inject list out of order, a `useExisting` mismatch) only surface
against a real container, never from typecheck or hand-constructed unit tests
alone.

### 11. Upgrade plan

Three tiers, stated per module where relevant:

- **Copy-sync** (fix in `ascendra-commons` → reaches a consumer's copy): today,
  manual `git rm` + re-copy. The real fix is an `ascendra-ui`-style
  `upgrade.js` diffing tool — not built yet, tracked once at the repo level
  (see root README), not repeated per module.
- **Model 1 → Model 2 migration**: what a module's own move to its richer
  model actually requires (schema, seed/backfill, an admin UI if one is
  needed) — stated in the module's own "Model 2" section as design work, not
  built speculatively (see dimension 6).
- **→ centralized service**: explicitly *not a roadmap item* for any module in
  this repo. The only named trigger anywhere in this repo is true cross-product
  identity (SSO across two genuinely concurrent live Ascendra products) — see
  root README or the relevant discussion — and even that is narrow identity
  infrastructure, not "move ascendra-commons into a service." Silence on this
  tier means "no trigger has occurred," not an oversight.

---

## 3. How to use this during a review

For each module, produce one row per dimension: **Pass**, **N/A (reason)**, or
**Gap**. A Gap is either missing documentation (the module does the right
thing but doesn't say so) or a real missing decision (the module never
considered the dimension at all). Only the latter is actual follow-up work;
the former is a README fix.
