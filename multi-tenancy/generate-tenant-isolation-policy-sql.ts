// Duplicated (not imported) from `optimistic-locking`'s / `soft-delete`'s
// identical check — each module in this library stays independently
// copyable. See `optimistic-locking`'s own doc comment for why a
// plain-identifier check is needed at all.
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidIdentifier(kind: string, value: string): void {
  if (!VALID_IDENTIFIER.test(value)) {
    throw new Error(`generateTenantIsolationPolicySql: ${kind} "${value}" is not a valid SQL identifier.`);
  }
}

export interface TenantIsolationPolicyOptions {
  /**
   * Include the payer branch (`payer_id = current_setting('app.current_payer_id', true)`)
   * — only for tables an identity-scoped persona can see directly (Invoice,
   * Payment in the project this pattern was promoted from), not every
   * tenant-scoped table. Default `false`.
   */
  includePayerBranch?: boolean;
}

/**
 * Just the predicate — `tenant_id = … or is_admin or (payer_id = …)` — for
 * composing into another module's own policy. `soft-delete`'s
 * `generateSoftDeletePolicySql({ scopingPredicateSql })` is the intended
 * composition point: pass this function's output there to combine tenant
 * isolation and soft-delete into one set of policies per table, rather than
 * two policies fighting each other (see that module's own README).
 */
export function tenantIsolationPredicateSql(options: TenantIsolationPolicyOptions = {}): string {
  const payerClause = options.includePayerBranch
    ? ` or payer_id = current_setting('app.current_payer_id', true)::uuid`
    : '';
  return (
    `tenant_id = current_setting('app.current_tenant_id', true)::uuid` +
    ` or current_setting('app.is_admin', true) = 'true'${payerClause}`
  );
}

/**
 * The full `CREATE POLICY` statement for a standalone tenant-scoped table —
 * use this when a table needs tenant isolation but not soft-delete; use
 * `tenantIsolationPredicateSql()` directly when composing with `soft-delete`
 * instead. Generates migration *text* for a developer to read and run
 * through the project's own migration tooling, the same trust level as SQL
 * written directly in a `.migration.sql` file — not parameterized, not
 * escaped beyond the table-name identifier check. Never pass end-user input
 * as `tableName`.
 */
export function generateTenantIsolationPolicySql(tableName: string, options: TenantIsolationPolicyOptions = {}): string {
  assertValidIdentifier('table name', tableName);
  return `alter table ${tableName} enable row level security;

create policy ${tableName}_tenant_isolation on ${tableName}
  using (
    ${tenantIsolationPredicateSql(options)}
  );
`;
}
