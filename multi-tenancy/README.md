# Multi-Tenancy Pattern

Every tenant boundary touches nearly every table and query — which makes it
tempting to think it must be "embedded everywhere" with no reuse possible.
This pattern makes tenancy reusable by generalizing the *enforcement
mechanism* into one convention applied uniformly (Postgres RLS + a
transaction-scoped session variable), rather than by extracting tenancy into
a separate service, which multi-tenancy genuinely is not — see "Why this
counts as reusable without being a service" below.

Self-contained at the SQL level (`generateTenantIsolationPolicySql` composes
with `soft-delete`'s own generator via a plain string predicate, not an
import), but does depend on `authorization.core` for `Actor` — the same
justified cross-module dependency `file-storage` already has, since resolving
a scope genuinely needs to know who the actor is.

No dot-package split — this is a declarative RLS convention with one correct
shape, not a swappable implementation (see `MODULE-STANDARD.md` §1b, and
"Why this counts as reusable" below for the module's own argument against
treating it as a service).

## The pattern

- **`TenantScope`** — `{ kind: 'tenant', tenantId }` / `{ kind: 'payer', payerId }`
  (any identity-scoped, cross-tenant persona) / `{ kind: 'admin' }`
  (unrestricted).
- **`TenantScopeResolver`** — how an `Actor` becomes a `TenantScope`. A real
  seam, not a hardcoded assumption: `Actor.persona` is intentionally a plain,
  project-defined string, so this module can't know which persona string
  means "admin" for a given project. `DefaultTenantScopeResolver` covers the
  common two-persona case (tenant-bound vs. unrestricted); a project with a
  third, identity-scoped persona (a `payer`) supplies its own.
- **`withTenantContext(db, scope, fn)`** — opens a transaction, sets the
  session variable for `scope`, confirms it actually landed, then runs `fn`.
  See "Confirmation, not blind trust" below.
- **`TenantContext`** — the request-scoped NestJS provider every repository
  calls `run()` on, reading the actor already established by the auth guard.
- **`generateTenantIsolationPolicySql(tableName, { includePayerBranch? })`** /
  **`tenantIsolationPredicateSql(options)`** — generates the `CREATE POLICY`
  migration text (or just the predicate, for composing with `soft-delete`).

## `set_config()`, not `SET LOCAL … = $1`

A plain `SET app.current_tenant_id = ...` is **session**-scoped: it persists
on the physical connection until changed, so under connection pooling (NestJS
doesn't give each request a dedicated connection; Supabase's own pooler adds
another layer of this) the value can leak across requests if that connection
is returned to the pool and picked up by a different request. The fix is a
value scoped to the transaction, discarded at `COMMIT`/`ROLLBACK` regardless
of the connection — but **not** via the `SET LOCAL name = value` statement
form: PostgreSQL's utility statements don't accept bound parameters over the
extended query protocol, so `SET LOCAL app.current_tenant_id = $1` is
rejected outright. `set_config(name, value, true)` is the documented
workaround — a real function call, so its value argument binds normally, and
the third argument (`true`) gives it the exact same transaction-scoped,
auto-discarded semantics as `SET LOCAL`.

## Confirmation, not blind trust (2026-09-12)

`withTenantContext()` reads the session variable back immediately after
setting it and compares. **This is the enforcement piece the observability
question for this module resolved to** — not a browsable admin log, since
there's no *row* to observe when the failure mode is "a query silently ran
with no tenant context at all." A pooler that discarded the `set_config` call
(wrong pooling mode, a connection swapped mid-transaction) would otherwise
leave every later query on that connection scoped to nothing — RLS fails
closed, so the caller sees zero rows, indistinguishable from "this tenant
genuinely has no data." `TenantContextNotEstablishedError` makes that fail
loud instead of silently returning an empty, plausible-looking result.

**What this does and doesn't catch.** It confirms the mechanism worked
*when it runs*. It does **not** catch a query that bypasses
`withTenantContext()`/`TenantContext.run()` entirely — a raw query issued
against the pool directly, without ever calling `run()`. The complementary
practice for that: **never bind the raw database/pool token to a feature
module's providers** — only bind `TenantContext`, so a repository has no way
to reach the database except through it. That's a DI-wiring discipline this
module's own code can't enforce for you (it's a decision about what your
`AppModule` exposes), but it's the piece that actually closes the gap this
one doesn't.

## Setting the session variable safely under connection pooling

```typescript
await withTenantContext(db, { kind: 'tenant', tenantId: 't-1' }, async (tx) => {
  return tx.select().from(invoice).where(eq(invoice.id, id)); // RLS applies the tenant filter, not this WHERE clause
});
```

Every repository method rides on `TenantContext.run()` (which calls this
internally), never manages `set_config()`/transactions itself.

## Why this counts as "reusable" without being a service

The reusable unit here is the *pattern* — one RLS policy template plus one
context-resolution service — applied consistently to every tenant-scoped
table via a shared migration helper, the same way a logging convention is
cross-cutting without being a callable service. There is no "tenancy
service" to build or operate; there is one convention to apply everywhere,
checked once (does this new table have `tenant_id` + the standard policy?)
whenever a table is added.

## Composing with `soft-delete`

```typescript
import { tenantIsolationPredicateSql } from '@/ascendra-commons/multi-tenancy';
import { generateSoftDeletePolicySql } from '@/ascendra-commons/soft-delete';

const sql = generateSoftDeletePolicySql('invoice', {
  scopingPredicateSql: tenantIsolationPredicateSql({ includePayerBranch: true }),
});
```

Composes the two concerns into one set of policies per table, rather than
two policies fighting each other over the same rows.

## Consuming this module

`node ascendra-commons.js add multi-tenancy` (see the root README, "Distribution").

## Depends on

`@nestjs/common`, `@nestjs/core` (`REQUEST`), `drizzle-orm` (for `sql`),
`authorization.core` (for `Actor`).
