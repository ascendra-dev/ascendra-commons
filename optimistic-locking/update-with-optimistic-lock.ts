import { sql } from 'drizzle-orm';
import type { OptimisticLockResult } from './optimistic-lock.types';
import type { SqlExecutor } from './sql-executor';

// drizzle-orm's own PgDialect.escapeName() is `` `"${name}"` `` — it wraps an
// identifier in double quotes but does NOT double an embedded `"` (the
// standard SQL way to escape one inside a quoted identifier). sql.identifier()
// is therefore not actually injection-safe against an adversarial identifier
// containing a quote character, despite its own doc comment's framing. Real
// callers pass hardcoded column names (`{ status: 'paid' }`), never
// user-controlled keys, so this is defense-in-depth rather than a directly
// exploitable path today — but it's cheap and correct to close outright:
// every identifier this helper touches must match a plain, boring SQL name.
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidIdentifier(kind: string, value: string): void {
  if (!VALID_IDENTIFIER.test(value)) {
    throw new Error(
      `updateWithOptimisticLock: ${kind} "${value}" is not a valid SQL identifier ` +
        `(must match ${VALID_IDENTIFIER}). Rejected before it ever reached the query.`,
    );
  }
}

/**
 * The one conditional-update helper every repository's `update()` method
 * calls, rather than reimplementing the check — see the module README, Rule 4.
 *
 * A single atomic `UPDATE … WHERE id = $id AND version = $expectedVersion …
 * RETURNING id`: zero rows affected means either the row doesn't exist or
 * (the ordinary case) someone else updated it since the caller last read it —
 * `rows.length` is the "did I win" check, not `rowCount`, the same reasoning
 * every other Postgres adapter in this library uses (`rowCount` isn't
 * reliably populated across `pg` / `postgres.js` for every statement shape).
 *
 * Operates on a table **name**, not a Drizzle table object — this module
 * never imports the consumer's own schema (see `SqlExecutor`'s doc comment).
 * Column/table identifiers are escaped via `sql.identifier()`, never string-
 * concatenated, so a column name can never become a SQL-injection vector even
 * though it's caller-supplied.
 *
 * `changes` must not include `id` or `version` — both are handled by this
 * helper itself (the `WHERE` clause and the `version + 1` bump respectively);
 * including either is almost certainly a caller bug (attempting to change a
 * row's identity, or to set the version explicitly instead of letting the
 * atomic increment do it) and throws immediately rather than silently
 * accepting a value that would just be overwritten.
 */
export async function updateWithOptimisticLock(
  db: SqlExecutor,
  tableName: string,
  id: string,
  expectedVersion: number,
  changes: Record<string, unknown>,
): Promise<OptimisticLockResult> {
  if ('id' in changes || 'version' in changes) {
    throw new Error(
      `updateWithOptimisticLock("${tableName}"): changes must not include "id" or "version" — ` +
        `both are handled by this helper itself.`,
    );
  }

  assertValidIdentifier('table name', tableName);
  for (const column of Object.keys(changes)) assertValidIdentifier('column name', column);

  const setClauses = [
    ...Object.entries(changes).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`),
    sql`version = version + 1`,
  ];

  const { rows } = await db.execute(sql`
    update ${sql.identifier(tableName)}
    set ${sql.join(setClauses, sql`, `)}
    where id = ${id} and version = ${expectedVersion}
    returning id
  `);

  return rows.length === 0 ? { ok: false, reason: 'stale_version' } : { ok: true };
}
