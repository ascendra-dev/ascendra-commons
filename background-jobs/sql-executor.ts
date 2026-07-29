import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape PostgresAdvisoryLock actually needs from the consumer's
 * database client — deliberately not the consumer's full schema-typed
 * Drizzle client, so this library never depends on any project's generated
 * schema (the same reasoning that keeps a raw query builder preferable to
 * the relational query API when a library only needs to run one ad hoc
 * statement). Any Drizzle `db` — `NodePgDatabase`, `PostgresJsDatabase`,
 * Supabase's pooled client wrapped the same way — satisfies this structurally.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
