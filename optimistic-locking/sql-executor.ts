import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape this module needs from the consumer's database client —
 * deliberately not the consumer's full schema-typed Drizzle client, so this
 * module never depends on any project's generated schema (the same reasoning
 * every `.postgres-drizzle` adapter in this library duplicates its own copy of
 * this interface for). `updateWithOptimisticLock()` operates on an arbitrary
 * table name, not a table object bound to one project's schema — that's what
 * lets it work against Invoice, Payment, or any other versioned entity without
 * this module ever importing the consumer's own Drizzle table definitions.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
