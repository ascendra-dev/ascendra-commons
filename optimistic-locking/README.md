# Optimistic Locking Pattern

Concurrency-conflict detection for entities where two actors could read-then-write
the same row — a `version` column plus a single atomic conditional `UPDATE`,
never a plain "read, mutate in memory, write back," which races.

No dependency on any other pattern in this library — self-contained. No Model 1 /
Model 2 split: there is exactly one way to do this against Postgres (a
conditional `UPDATE`), no plausible second backend, so this stays a **flat
module** rather than a container of dot-named packages (see `MODULE-STANDARD.md`
§1b — a split is for a real second implementation or an admin/observability
surface, and this has neither).

## The pattern

- **A `version` column, added only where it matters** — the entities that can
  actually be read-then-written by two actors (e.g. Invoice, Payment), not
  every table.
- **`updateWithOptimisticLock(db, tableName, id, expectedVersion, changes)`** —
  the one conditional-update helper every repository's `update()` method calls,
  rather than reimplementing the check. One atomic
  `UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $expectedVersion RETURNING id`.
  Zero rows back (`rows.length`, not `rowCount` — see the doc comment) means the
  row was updated by someone else since the caller last read it; the helper
  returns `{ ok: false, reason: 'stale_version' }`, never throws for this
  ordinary case.
- **Operates on a table name, not a Drizzle table object** — this module never
  imports the consumer's own schema (see `sql-executor.ts`). Column and table
  identifiers are validated against a plain-identifier pattern and rejected
  outright if they aren't, before ever reaching `sql.identifier()` — that
  helper quotes an identifier (`drizzle-orm`'s `PgDialect.escapeName` is
  literally `` `"${name}"` ``) but does not escape an embedded `"`, so it isn't
  actually injection-safe against an adversarial identifier on its own.
- **`changes` must not include `id` or `version`** — both are handled by the
  helper itself; including either throws immediately rather than silently
  accepting a value that would just be overwritten.
- **`StaleVersionError`** — a call site escalates a `{ ok: false }` result into
  this when it wants a multi-entity transaction to roll back on it (see below);
  the helper itself never throws it.

## Multiple entities updated together — no special coordinator

```typescript
await db.transaction(async (tx) => {
  const invoiceResult = await updateWithOptimisticLock(tx, 'invoice', invoiceId, expectedInvoiceVersion, { status: 'paid' });
  if (!invoiceResult.ok) throw new StaleVersionError('invoice', invoiceId, expectedInvoiceVersion);

  const paymentResult = await updateWithOptimisticLock(tx, 'payment', paymentId, expectedPaymentVersion, { confirmedAt: new Date() });
  if (!paymentResult.ok) throw new StaleVersionError('payment', paymentId, expectedPaymentVersion);
});
```

If any entity's version check fails, the transaction rolls back entirely —
atomicity across multiple entities comes from the ordinary DB transaction
boundary, not from additional cross-entity logic in this module.

## The wire contract — a consumer concern, not this module's

How `version` reaches the wire (a single-resource `GET` returning it as a
quoted `ETag`; a collection `GET` carrying it as a per-row `version` field
since one `ETag` can't cover many rows; a write carrying the expected version
via `If-Match`, never a body field; a mismatch surfacing as `409 Conflict` with
a structured `STALE_VERSION` code) is a **consumer-project decision**, usually
fixed by that project's own API contract rather than invented per-endpoint.
This module supplies the repository-layer enforcement only; the controller
layer is responsible for reading `If-Match`, calling this helper, and mapping
`{ ok: false }` to the project's own conflict-response shape.

## Observability

Not built — deliberately. A version conflict is already surfaced synchronously
to the caller that hit it (`{ ok: false, reason: 'stale_version' }` →
`409 Conflict`), so there's no silent-failure mode the way there was for
`idempotency-key`'s reclaim/no-op cases. A consumer that wants to track
conflict *rate* (to distinguish routine concurrent edits from a client retry
storm) can do so from its own audit/metrics layer — the flat, typed result this
helper returns is enough to log from, without this module needing to own a
table of its own.

## Consuming this module

Copy `optimistic-locking/` into `src/ascendra-commons/optimistic-locking/`.

```typescript
import { updateWithOptimisticLock, StaleVersionError } from '@/ascendra-commons/optimistic-locking';
```

## Depends on

`drizzle-orm` (for `sql`/`sql.identifier` — the query-building primitives
only, never a project's generated schema).
