import { sql } from 'drizzle-orm';
import type { SqlExecutor, TransactionalDb } from './sql-executor';
import type { TenantScope } from './tenant-scope';

/**
 * Thrown by `withTenantContext()` when the session variable it just set
 * doesn't read back — see the doc comment on the confirmation read below.
 */
export class TenantContextNotEstablishedError extends Error {
  constructor(scope: TenantScope) {
    super(
      `Tenant context (${scope.kind}) was set but did not take effect — the confirmation read of the ` +
        `session variable came back different from what was just set. This usually means the ` +
        `transaction's connection isn't the one the SET actually landed on (a connection-pooling ` +
        `misconfiguration — see multi-tenancy's README on Supabase's transaction-mode pooler), not a ` +
        `bug in the caller. Failing loudly here is the point: the alternative is every query on this ` +
        `connection silently returning zero rows instead of the caller's data, indistinguishable from ` +
        `"this tenant genuinely has nothing."`,
    );
    this.name = 'TenantContextNotEstablishedError';
  }
}

/**
 * NestJS does not give each HTTP request a dedicated Postgres connection —
 * it uses a pool, and Supabase's own pooler (PgBouncer, transaction mode)
 * adds another layer of this. A plain `SET app.current_tenant_id = ...` is
 * **session**-scoped: it persists on the physical connection until changed,
 * so if that connection is returned to the pool and picked up by a different
 * request for a different tenant, the old value can leak across requests.
 *
 * The fix is `set_config(name, value, true)` — the third argument makes it
 * `LOCAL`, exactly like `SET LOCAL`: scoped to the transaction, automatically
 * discarded at `COMMIT`/`ROLLBACK` regardless of what the underlying
 * connection does afterward. **Not the `SET LOCAL name = value` statement
 * form** — PostgreSQL's utility statements (`SET` among them) don't accept
 * bound parameters over the extended query protocol, so
 * `SET LOCAL app.current_tenant_id = $1` is rejected outright. `set_config()`
 * is a real function call, so its value argument binds normally — the
 * standard, documented way to parameterize what `SET LOCAL` can't.
 *
 * **Confirmation, not blind trust:** immediately after setting it, this reads
 * the same session variable back and compares. A pooler that silently
 * discarded the `SET` (wrong pooling mode, a bug, a connection swapped mid-
 * transaction) would otherwise leave every subsequent query on this
 * connection scoped to *nothing* — RLS fails closed, so the caller would see
 * zero rows, indistinguishable from "this tenant genuinely has no data."
 * That's the one blind spot this pattern is otherwise silent about; this
 * closes it by failing loudly instead. It does **not** catch a query that
 * bypasses `withTenantContext()`/`TenantContext.run()` entirely — see the
 * module README, "What this does and doesn't catch."
 */
export async function withTenantContext<T>(
  db: TransactionalDb,
  scope: TenantScope,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const { settingName, value } = settingFor(scope);
    await tx.execute(sql`select set_config(${settingName}, ${value}, true)`);

    const { rows } = await tx.execute(sql`select current_setting(${settingName}, true) as value`);
    if (String(rows[0]?.value ?? '') !== value) {
      throw new TenantContextNotEstablishedError(scope);
    }

    return fn(tx);
  });
}

function settingFor(scope: TenantScope): { settingName: string; value: string } {
  switch (scope.kind) {
    case 'tenant':
      return { settingName: 'app.current_tenant_id', value: scope.tenantId };
    case 'payer':
      return { settingName: 'app.current_payer_id', value: scope.payerId };
    case 'admin':
      return { settingName: 'app.is_admin', value: 'true' };
  }
}
