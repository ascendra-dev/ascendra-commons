// Duplicated (not imported) from `optimistic-locking`'s identical check — each
// module in this library stays independently copyable, so a small utility
// like this is copied, not shared. See that module's own doc comment for why
// a plain-identifier check is needed at all (drizzle-orm's `sql.identifier()`
// alone isn't injection-safe against an adversarial identifier).
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidIdentifier(kind: string, value: string): void {
  if (!VALID_IDENTIFIER.test(value)) {
    throw new Error(`generateSoftDeletePolicySql: ${kind} "${value}" is not a valid SQL identifier.`);
  }
}

export interface SoftDeletePolicyOptions {
  /**
   * An extra `USING`/`WITH CHECK` predicate, already valid SQL, to `AND` with
   * this table's soft-delete condition — typically this project's own
   * tenant-isolation fragment from its `multi-tenancy` policy (so the two
   * compose into one set of policies, not two competing ones). Omit to scope
   * by row state (`deleted_at`) alone.
   *
   * **Not parameterized / not escaped** — this generates migration *text* for
   * a human to read and run via the project's own migration tooling, not a
   * runtime-executed query; the caller is a developer authoring a migration,
   * trusted the same way the SQL literally written in this module's own
   * README is trusted. Never pass end-user input here.
   */
  scopingPredicateSql?: string;
}

/**
 * Generates the two-policy split this pattern exists to get right by
 * construction rather than by every migration author re-deriving it: a
 * single combined policy would reject the soft-delete `UPDATE` itself
 * (Postgres RLS applies the same `USING` clause both before *and* after an
 * `UPDATE`, via an implicit `WITH CHECK`), so `deleted_at IS NULL` must gate
 * `SELECT` and the *pre-image* of `UPDATE` only, never the post-image.
 *
 * Returns the migration text — print it into a `.sql` file via the
 * project's own migration tooling, the same way every other Postgres
 * adapter in this library treats its own reference `.migration.sql`.
 */
export function generateSoftDeletePolicySql(tableName: string, options: SoftDeletePolicyOptions = {}): string {
  assertValidIdentifier('table name', tableName);
  const scoping = options.scopingPredicateSql?.trim();
  const selectPredicate = scoping ? `deleted_at is null\n    and (${scoping})` : `deleted_at is null`;
  const updateUsingPredicate = scoping ? `deleted_at is null\n    and (${scoping})` : `deleted_at is null`;
  const updateCheckPredicate = scoping ? scoping : `true`;

  return `alter table ${tableName} enable row level security;

-- SELECT: soft-deleted rows are invisible to everyone.
create policy ${tableName}_select on ${tableName} for select
  using (
    ${selectPredicate}
  );

-- UPDATE: a row can only be updated while not yet deleted (USING) — but the row
-- AFTER the update is allowed to have deleted_at set, since WITH CHECK does not
-- repeat that condition. This is what lets the soft-delete write itself succeed.
create policy ${tableName}_update on ${tableName} for update
  using (
    ${updateUsingPredicate}
  )
  with check (
    ${updateCheckPredicate}
  );
`;
}
