import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FileCategoryRegistry, ResolvedFileCategory } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { FILE_CATEGORY_CACHE, FILE_STORAGE_SQL_EXECUTOR } from '../tokens';
import { parseBaseRow, parseOverrideRow } from './category-row';
import { mergeCategory } from './category-merge';
import type { CategoryCache } from './category-cache';

/**
 * The database-backed `FileCategoryRegistry` (decision 8). `resolve` reads at
 * most a base row (`tenant_id IS NULL`) and one tenant override row, merges
 * them, and caches the result for `cacheTtlMs`.
 */
@Injectable()
export class PostgresFileCategoryRegistry implements FileCategoryRegistry {
  constructor(
    @Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(FILE_CATEGORY_CACHE) private readonly cache: CategoryCache,
  ) {}

  async resolve(tenantId: string | null, key: string): Promise<ResolvedFileCategory | null> {
    return this.cache.get(`resolve:${tenantId ?? 'base'}:${key}`, async () => {
      const { rows } = await this.db.execute(sql`
        select * from commons_file_category
        where key = ${key} and (tenant_id is null${tenantId ? sql` or tenant_id = ${tenantId}` : sql``})
      `);
      const baseRow = rows.find((r) => r.tenant_id === null || r.tenant_id === undefined);
      if (!baseRow) return null;
      const overrideRow = rows.find((r) => r.tenant_id != null);
      return mergeCategory(parseBaseRow(baseRow), overrideRow ? parseOverrideRow(overrideRow) : null);
    });
  }

  async list(tenantId: string | null): Promise<ResolvedFileCategory[]> {
    return this.cache.get(`list:${tenantId ?? 'base'}`, async () => {
      const { rows } = await this.db.execute(sql`
        select * from commons_file_category
        where tenant_id is null${tenantId ? sql` or tenant_id = ${tenantId}` : sql``}
        order by key
      `);
      const bases = new Map<string, Record<string, unknown>>();
      const overrides = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        if (r.tenant_id == null) bases.set(r.key as string, r);
        else overrides.set(r.key as string, r);
      }
      return [...bases.entries()].map(([key, baseRow]) => {
        const o = overrides.get(key);
        return mergeCategory(parseBaseRow(baseRow), o ? parseOverrideRow(o) : null);
      });
    });
  }
}
