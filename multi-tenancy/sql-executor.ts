import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape this module needs from the consumer's database client —
 * deliberately not the consumer's full schema-typed Drizzle client, so this
 * module never depends on any project's generated schema (duplicated, not
 * imported, from every other Postgres adapter's identical copy elsewhere in
 * this library).
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** A db handle that can open a transaction and hand back a `SqlExecutor` scoped to it — any Drizzle `db.transaction(...)` satisfies this structurally. */
export interface TransactionalDb {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
