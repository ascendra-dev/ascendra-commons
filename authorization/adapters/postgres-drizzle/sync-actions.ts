import { sql } from 'drizzle-orm';
import { textArray } from './sql-helpers';
import type { SqlExecutor } from './sql-executor';

/**
 * Upsert the app's action keys into `authz_action`. Run at startup or from a
 * migration, with `Object.values(Actions)` (your project's action catalog).
 *
 * **Insert-only.** A new key gets a row with `description = NULL`. Existing rows
 * are never touched — a description typed into the admin UI survives every
 * redeploy. Keys removed from the code catalog are **not** deleted here (the
 * `authz_role_permission` FK would block it anyway); removing an action is a
 * deliberate migration.
 */
export async function syncActions(db: SqlExecutor, actionKeys: readonly string[]): Promise<void> {
  const keys = [...new Set(actionKeys)].filter((k) => k.length > 0);
  if (keys.length === 0) return;
  await db.execute(sql`
    INSERT INTO authz_action (name)
    SELECT unnest(${textArray(keys)})
    ON CONFLICT (name) DO NOTHING
  `);
}
