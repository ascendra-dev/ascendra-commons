import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape the Postgres adapters need from the consumer's database
 * client — deliberately not the consumer's full schema-typed Drizzle client,
 * so this adapter never depends on any project's generated schema.
 *
 * `{ rows }` only, aligned with the other modules' adapters. Every write that
 * needs a result uses `RETURNING`, so `rows.length` is the portable check;
 * `rowCount` is not reliably populated across `pg` vs `postgres.js`.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
