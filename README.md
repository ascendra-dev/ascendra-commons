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

Five patterns implemented so far, all tested with real NestJS DI wiring:
`domain-events/`, `notification/`, `authorization/`, `background-jobs/`,
`audit-logging/` (depends on `domain-events/` also being vendored — see its
README). Everything else is deliberately not built yet — each pattern gets
promoted from `ascendra-pay-002`'s own project-specific standards docs one at
a time, only once a real story needs it, never speculatively.

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
