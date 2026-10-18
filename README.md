# Ascendra Commons

Reusable backend architecture patterns for Ascendra-umbrella projects sharing the
same tech stack (NestJS + Drizzle + Supabase, consumed by Next.js frontends via
`ascendra-ui`). Not technology-agnostic — scoped specifically to that stack.

## Distribution

Copy-based, mirroring `ascendra-ui`'s model: a consumer project copies a pattern's
folder into its own `src/ascendra-commons/{pattern}/`, unchanged, same folder
name, under one wrapper folder that distinguishes vendored code from the
project's own (see `module-packaging-pattern.md` in the `ascendra-pay-002`
project for the full reasoning). No npm publish step, no package registry.

`ascendra-commons.js` (this repo's root; zero dependencies) does the copying and
keeps it honest. From the consumer project's root:

```bash
node ../ascendra-commons/ascendra-commons.js init     # once: copies the script in, writes ascendra-commons.json
node ascendra-commons.js add audit-logging.core.postgres-drizzle domain-events.core.in-process
node ascendra-commons.js update                       # later: newer commons, safely
node ascendra-commons.js status                       # read-only check (exit 1 on a problem — fit for CI)
node ascendra-commons.js remove <package>
```

- **`add`** copies the packages into `src/ascendra-commons/` — unchanged, minus their
  tests (`*.spec.ts`, which run here) and design mocks (`mocks.html`) — plus every
  package their code imports (`audit-logging.core`, `domain-events.core`, …). A
  choice between implementations — an emitter transport, an authorization model —
  is never imported, so name it; each module README's "Consuming this module"
  says which.
- **`update`** refuses if vendored files were edited locally (a sha256 per file
  in `src/ascendra-commons/VENDORED.json`), shows the commits touching your
  packages since the vendored one — **breaking changes first** — and asks before
  replacing anything. A project's packages always come from one commit: `add`
  matches the vendored commit; moving forward is `update`'s job.
- **Migrations** (`<package>/migrations/NNNN_*.sql`, never edited once released —
  `MODULE-STANDARD.md` dimension 7) are delivered once into the project's own
  migrations — via `drizzle-kit generate --custom` (so its journal lists them) or
  as a timestamped copy into a plain folder — and an update delivers only new
  ones, refusing if a delivered one changed upstream.
- It lists npm packages the project lacks; it never runs `npm install`, writes
  `forRoot()` wiring, or touches a database. `--from <path>` reads a local
  checkout instead of GitHub, to try unpushed work.

**Breaking changes** are marked in the commit, where `update` finds them: a `!`
after the type and a `BREAKING CHANGE:` footer saying what the consumer must do
(`feat(audit-logging)!: …` / `BREAKING CHANGE: pass catalog to forRoot()`). A
change that needs several steps also gets an `UPGRADING.md` in the package. No
CHANGELOG file — and `main`'s history is never rewritten, or a consumer's
vendored commit disappears (`update` then falls back to a plain file diff).

**Repo rules the script relies on** are enforced by `npm run check`
(`scripts/check.js`), which a pre-push hook runs — `npm install` installs it:
packages import each other only through `index.ts` and only toward `.core`;
migrations live in `<package>/migrations/`, numbered without gaps; nothing on
`origin/main` under a `migrations/` folder changes; and every `!` commit carries
its `BREAKING CHANGE:` footer.

## Integrating into a project

What a consuming NestJS project does, once per project and then per module.
`ascendra-commons-sandbox` follows it to the letter — its `src/modules/commons/`
is the worked example.

1. **Vendor** — `node ascendra-commons.js init`, then `add` the packages you need
   (see "Distribution"). Never edit `src/ascendra-commons/`.
2. **Migrate** — the delivered migrations land in your migrations folder; apply
   them with your own tool (`drizzle-kit migrate`). Keep your `drizzle-kit`
   schema to your own tables — never the vendored `*.schema.ts`.
3. **Configure in one place** — `src/modules/commons/`: one file per module
   holding its `forRoot(...)` (and its config: catalog, persona map, …), and a
   `CommonsModule` that imports them all, which your `AppModule` imports. Module
   READMEs show each `forRoot`.
4. **Provide what the modules expect from the host:**
   - **A database connection** under a token you pass as `sqlExecutorToken` —
     any Drizzle pg database satisfies the adapters' minimal `SqlExecutor`
     (`execute(sql) → { rows }`). An adapter writes through exactly the executor
     it's given: for an audit record to roll back with the change it records,
     give it one bound to the caller's transaction (with a plain pool it isn't).
   - **`request.actor`** — `{ id, persona, tenantId }` (`authorization.core`'s
     `Actor`), set by your authentication *before* authorization's global
     `AuthorizationGuard` runs. That guard is deny-by-default: every route needs
     `@RequiresAction(...)` or `@NoActionRequired()`.
   - **`CorrelationIdMiddleware`** on every route (from `audit-logging.core`), so
     audit records from one request share a correlation id.
   - **`application`** — your app's id, passed to each Postgres adapter's
     `forRoot`; it's stamped on every row and every read filters by it.
   - **api-contract plumbing** — the Rule 1 error filter and `X-Request-Id`
     (Rule 7), so the modules' endpoints answer like your own.
5. **Keep it current** — `node ascendra-commons.js update`, then migrate.
   `status` in CI catches an edited copy or an undelivered migration.

## Status

Fifteen patterns implemented, all tested with real NestJS DI wiring:
`domain-events/`, `notification/`, `authorization/`, `background-jobs/`,
`audit-logging/` (depends on `domain-events.core` also being vendored),
`file-storage/` (depends on `authorization.core` also being vendored),
`idempotency-key/` (no dependency on any other pattern) — see each
pattern's own README for why. Those seven are split into dot-named
packages (§1b).

Eight more (2026-09-12), promoted from `ascendra-pay-002`'s own
project-specific standards docs — see each pattern's own README for why it
took the shape it did:

- **Flat, single-folder, no split** (one implementation, no admin surface):
  `optimistic-locking/` (a shared atomic-update helper), `soft-delete/` (an
  RLS policy generator, composable with `multi-tenancy`), `localization-currency/`
  (`Money` + validation + correct-for-any-currency minor-unit conversion),
  `multi-tenancy/` (RLS + `TenantContext`, plus a **fail-loud confirmation
  check** in place of a browsable admin log — see its own README for why an
  observability *table* would be the wrong shape for this module's actual gap).
- **Split, with a genuine observability surface**: `rate-limiting/`
  (`.core` / `.core.throttler` / `.core.postgres-drizzle` / `.api` — the
  `@nestjs/throttler` integration is the one concrete "family" package, not a
  Model 1/2 choice), `payment-link-security/` (`.core` /
  `.core.postgres-drizzle` / `.api` — hashed tokens, never raw, at rest or in
  the resolution log), `payment-gateway-adapter/` (`.core` /
  `.core.postgres-drizzle` / `.api` — **only the generic webhook mechanics**;
  the concrete adapters touching Invoice/Payment stay project-owned, see its
  README's scoping note).

Everything else is deliberately not built yet — each pattern gets promoted
one at a time, only once a real story needs it, never speculatively.

## Layout

Each pattern is a folder of small, single-responsibility files (types, one
interface + implementation(s) per file, a NestJS module wiring them together)
with an `index.ts` barrel export as its only public surface, plus its own
`README.md` (Overview, the pattern itself, Model 1 / Model 2 split, how to
consume it) and a `.spec.ts` per file proving the Model 1 implementation
actually behaves as documented — including at least one test that boots a real
NestJS `Test.createTestingModule`, since wiring bugs (a missing binding, a
`useFactory` inject list out of order, a `useExisting` mismatch) only surface
when a real container resolves the dependency graph, not from typecheck or
hand-constructed unit tests alone.

A pattern that has outgrown one folder — a real Model 1 *and* Model 2, more than
one plausible Model 2 stack, an admin/observability surface — becomes a
**container folder of dot-named packages** (`authorization.core`,
`authorization.core.static-map`, `authorization.core.permission-table`,
`authorization.core.permission-table.postgres-drizzle`, `authorization.api`),
each an independent copy unit with its own barrel and README, dependencies
one-way toward `.core`. See `MODULE-STANDARD.md` §1b. `authorization`,
`notification`, `audit-logging`, `background-jobs`, `domain-events`,
`idempotency-key` and `file-storage` (2026-09-07) are split this way —
`audit-logging`/`background-jobs` use `.core` / `.core.postgres-drizzle` /
`.api`; `domain-events` uses `.core` / `.core.in-process` / `.core.broker` /
`.core.postgres-drizzle` (delivery-log observability, 2026-09-12) / `.api`;
`idempotency-key` uses `.core` / `.core.postgres-drizzle` / `.core.redis` /
`.api` (claim observability, 2026-09-12);
`file-storage` uses `.core` / `.core.supabase` / `.core.s3` (the two `FileStore`
backends) / `.core.postgres-drizzle` (metadata + category catalog + access log)
/ `.api`. `rate-limiting`, `payment-link-security`, and `payment-gateway-adapter`
(2026-09-12) are split the same way for the same trigger — a genuine
observability surface, added when three independently-reviewed patterns
turned out to share one recurring gap-shape (a correct-but-silent no-op on a
security-relevant path — a rejected request, a guessed token, an ignored
webhook redelivery); see `MODULE-STANDARD-AUDIT.md`'s 2026-09-12 entry for
the full reasoning. `optimistic-locking`, `soft-delete`, `localization-currency`,
and `multi-tenancy` are **not** split — each has one correct implementation
and no admin surface (or, for `multi-tenancy`, a real gap closed by a
fail-loud runtime check instead — see its own README).

`module-packaging-pattern.md` (the `ascendra-pay-002` standards doc describing
*this* copy-based distribution model) is not itself promoted as a module here
— its content already lives in this file and in `MODULE-STANDARD.md`.

See `MODULE-STANDARD.md` for the full checklist every pattern is built and
audited against — export boundary, packaging, `applicationId`/`tenantId`
seams, the Model 1/Model 2 split, persistence ownership, UI contract, naming,
testing, and the upgrade plan (copy-sync tooling, Model 1→2 migration, and why
"→ a centralized service" is deliberately not a roadmap item for any module
here).
