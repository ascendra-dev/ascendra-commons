import { sql } from 'drizzle-orm';
import type { FileCategory } from '../../../file-storage.core';
import { textArray, jsonbParam } from '../../persistence/sql-helpers';
import type { SqlExecutor } from '../../persistence/sql-executor';

/**
 * Write the developer-declared **base** category definitions into
 * `commons_file_category` as `tenant_id IS NULL, source = 'seed'` rows.
 *
 * Idempotent and **insert-if-absent** (`ON CONFLICT (key) WHERE tenant_id IS
 * NULL DO NOTHING`): a base row that already exists is left untouched, so an
 * admin's later edits to a seeded row survive a redeploy. A base category an
 * admin *deleted* returns on the next deploy — code owns the baseline.
 *
 * Per-tenant override rows are never touched here.
 *
 * `PostgresFileCategoryRegistryModule.forRoot({ seedCategories })` runs this on
 * boot; a project that prefers an explicit step calls it from a migration or a
 * CLI script instead.
 */
export async function seedFileCategories(db: SqlExecutor, categories: readonly FileCategory[]): Promise<void> {
  for (const c of categories) {
    await db.execute(sql`
      insert into commons_file_category
        (key, tenant_id, source, active, label, description, bucket, retention,
         allowed_content_types, max_size_bytes, min_size_bytes, allowed_extensions,
         on_unscannable, signed_link_expiry_seconds)
      values
        (${c.key}, null, 'seed', true, ${c.label}, ${c.description ?? null}, ${c.bucket}, ${jsonbParam(c.retention)},
         ${c.allowedContentTypes.length > 0 ? textArray(c.allowedContentTypes) : sql`null`},
         ${c.maxSizeBytes}, ${c.minSizeBytes ?? 1},
         ${c.allowedExtensions && c.allowedExtensions.length > 0 ? textArray(c.allowedExtensions) : sql`null`},
         ${c.onUnscannable}, ${c.signedLinkExpirySeconds ?? null})
      on conflict (key) where tenant_id is null do nothing
    `);
  }
}
