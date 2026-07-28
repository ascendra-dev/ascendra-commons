# Ascendra API Patterns

Reusable backend architecture patterns for Ascendra-umbrella projects sharing the
same tech stack (NestJS + Drizzle + Supabase, consumed by Next.js frontends via
`ascendra-ui`). Not technology-agnostic — scoped specifically to that stack.

## Distribution

Copy-based, mirroring `ascendra-ui`'s model: a consumer project copies a pattern's
folder into its own `src/`, verbatim, same folder name. No npm publish step, no
package registry. There is no upgrade tooling yet — that gets built once there's a
second version of a pattern that a consumer actually needs to sync to, not before.

## Status

Two patterns implemented so far: `domain-events/`, `notification/`. Everything
else is deliberately not built yet — each pattern gets promoted from
`ascendra-pay-002`'s own project-specific standards docs one at a time, only once
a real story needs it, never speculatively.

## Layout

Each pattern is a flat top-level folder (e.g. `domain-events/`) with an `index.ts`
barrel export as its only public surface, plus its own `README.md` describing the
pattern (Overview, the pattern itself, Model 1 / Model 2 split) and a `.spec.ts`
test suite proving the Model 1 implementation actually behaves as documented.
