# Soft Delete Pattern

Financial/business entities must never be hard-deleted (that destroys the
audit trail's own subject matter) but also must not simply accumulate forever
in every ordinary query's result set. The guarantee comes from Postgres RLS —
the same structural mechanism `multi-tenancy` uses — not from a developer
remembering to add `WHERE deleted_at IS NULL` to every query by hand (the
exact failure mode `multi-tenancy` already exists to prevent, for tenant
isolation, applied here to a second, related problem).

No dependency on any other pattern in this library — self-contained; it
*composes* with a project's own tenant-isolation predicate via
`scopingPredicateSql` rather than importing `multi-tenancy` directly, so
either module can be vendored without the other. No Model 1 / Model 2 split —
this is a declarative RLS convention with one correct shape, not a swappable
implementation (see `MODULE-STANDARD.md` §1b).

## The subtlety this pattern exists to get right

A single combined policy applying `deleted_at IS NULL` to both reads and
writes would reject the soft-delete action itself: Postgres RLS applies the
same `USING` clause both before *and* after an `UPDATE` (via an implicit
`WITH CHECK`), so a row that no longer satisfies `deleted_at IS NULL` after
`SET deleted_at = now()` would be rejected by the very policy meant to make
deletion automatic. The fix is separate `FOR SELECT` and `FOR UPDATE`
policies — `UPDATE`'s `USING` repeats `deleted_at IS NULL` (a row can only be
touched while not yet deleted), but its `WITH CHECK` does not (the row *after*
the update is allowed to have `deleted_at` set).

`generateSoftDeletePolicySql(tableName, { scopingPredicateSql? })` generates
that exact two-policy text — a migration-authoring helper, not a runtime
query path. Pass your project's own tenant/payer/admin predicate as
`scopingPredicateSql` to compose the two concerns into one set of policies
per table, rather than two policies fighting each other.

```typescript
import { generateSoftDeletePolicySql } from '@/ascendra-commons/soft-delete';

const sql = generateSoftDeletePolicySql('invoice', {
  scopingPredicateSql:
    `tenant_id = current_setting('app.current_tenant_id', true)::uuid ` +
    `or current_setting('app.is_admin', true) = 'true' ` +
    `or payer_id = current_setting('app.current_payer_id', true)::uuid`,
});
// write `sql` into your migration file
```

**Not parameterized, not escaped beyond the table-name identifier check** —
this produces migration *text* for a developer to read and run through the
project's own migration tooling, the same trust level as SQL written directly
in a `.migration.sql` file. Never pass end-user input as `scopingPredicateSql`.

## Implementations — no manual `WHERE` clause anywhere

No repository method adds `deleted_at IS NULL` itself — the guarantee comes
from Postgres enforcing it on every query against the table, including a raw
query or one written by someone unfamiliar with the convention. A soft-delete
write is a plain `UPDATE … SET deleted_at = now()`; RLS's `USING` clause
already confirms the caller was allowed to touch the row and that it wasn't
already deleted — no additional application-level check is needed.

## Scope

Applied to entities where hard deletion would be inappropriate — not
blanket-applied to every table. An append-only table (an audit log) is never
deleted at all and doesn't need this. A soft-delete action itself should raise
a domain event and be captured in whatever audit trail the project has, like
any other state change — not exempted from it.

## Recovery

Not built. If a soft-deleted row genuinely needs recovering, that's a direct
database action (the hosting provider's SQL console, or `psql`) until a real,
repeated recovery need justifies building a dedicated admin "trash" view and
undelete action — the same discipline this library applies to every deferred
Model 2 elsewhere.

## Observability

Not built. A soft-delete is a normal, application-visible write — nothing
about it fails silently the way `idempotency-key`'s reclaim/no-op cases did.
The audit trail (via whatever `AuditableDomainEvent`-style mechanism the
project uses — see `audit-logging`) is the observability surface for "who
deleted what and when"; this module doesn't need a parallel one.

## Consuming this module

Copy `soft-delete/` into `src/ascendra-commons/soft-delete/`.

## Depends on

Nothing — plain string templating.
