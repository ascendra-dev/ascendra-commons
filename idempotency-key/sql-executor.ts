import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape PostgresIdempotencyStore actually needs from the
 * consumer's database client — deliberately not the consumer's full
 * schema-typed Drizzle client, so this library never depends on any
 * project's generated schema. The same reasoning background-jobs' own
 * SqlExecutor uses; duplicated here rather than imported from there, so
 * this pattern stays independently copyable.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }>;
}
