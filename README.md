# Ascendra Commons

Reusable backend architecture patterns for Ascendra-umbrella projects sharing the
same tech stack (NestJS + Drizzle + Supabase, consumed by Next.js frontends via
`ascendra-ui`). Not technology-agnostic — scoped specifically to that stack.

## Distribution

Copy-based, mirroring `ascendra-ui`'s model: a consumer project copies a pattern's
folder into its own `src/ascendra-commons/{pattern}/`, verbatim, same folder
name, under one wrapper folder that distinguishes vendored code from the
project's own (see `module-packaging-pattern.md` in the `ascendra-pay-002`
project for the full reasoning). No npm publish step, no package registry.
There is no upgrade tooling yet — that gets built once there's a second version
of a pattern that a consumer actually needs to sync to, not before.

## Status

Seven patterns implemented so far, all tested with real NestJS DI wiring:
`domain-events/`, `notification/`, `authorization/`, `background-jobs/`,
`audit-logging/` (depends on `domain-events.core` also being vendored),
`file-storage/` (depends on `authorization.core` also being vendored),
`idempotency-key/` (no dependency on any other pattern) — see each
pattern's own README for why. All seven are now split into dot-named
packages (§1b). Everything else is deliberately not built yet
— each pattern gets promoted from `ascendra-pay-002`'s own project-specific
standards docs one at a time, only once a real story needs it, never
speculatively.

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
/ `.api`.

See `MODULE-STANDARD.md` for the full checklist every pattern is built and
audited against — export boundary, packaging, `applicationId`/`tenantId`
seams, the Model 1/Model 2 split, persistence ownership, UI contract, naming,
testing, and the upgrade plan (copy-sync tooling, Model 1→2 migration, and why
"→ a centralized service" is deliberately not a roadmap item for any module
here).
