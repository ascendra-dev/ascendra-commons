import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CategoryNotFoundError,
  type FileCategoryAdminPort,
  type FileCategoryOverrideInput,
  type FileCategoryView,
} from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { textArray } from '../persistence/sql-helpers';
import { FILE_CATEGORY_CACHE, FILE_STORAGE_SQL_EXECUTOR } from '../tokens';
import { parseBaseRow, parseOverrideRow, type OverrideCategoryRow } from './category-row';
import { assertOverrideTightens, mergeCategory } from './category-merge';
import type { CategoryCache } from './category-cache';

@Injectable()
export class PostgresFileCategoryAdminService implements FileCategoryAdminPort {
  constructor(
    @Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(FILE_CATEGORY_CACHE) private readonly cache: CategoryCache,
  ) {}

  async listCategories(tenantId: string | null): Promise<FileCategoryView[]> {
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
    return [...bases.entries()].map(([key, b]) => this.toView(key, b, overrides.get(key)));
  }

  async getCategory(tenantId: string | null, key: string): Promise<FileCategoryView | null> {
    const { rows } = await this.db.execute(sql`
      select * from commons_file_category
      where key = ${key} and (tenant_id is null${tenantId ? sql` or tenant_id = ${tenantId}` : sql``})
    `);
    const base = rows.find((r) => r.tenant_id == null);
    if (!base) return null;
    return this.toView(key, base, rows.find((r) => r.tenant_id != null));
  }

  async upsertTenantOverride(
    tenantId: string,
    key: string,
    input: FileCategoryOverrideInput,
  ): Promise<FileCategoryView> {
    const { rows } = await this.db.execute(sql`
      select * from commons_file_category where key = ${key} and (tenant_id is null or tenant_id = ${tenantId})
    `);
    const baseRow = rows.find((r) => r.tenant_id == null);
    if (!baseRow) throw new CategoryNotFoundError(key);
    const base = parseBaseRow(baseRow);

    const existing = rows.find((r) => r.tenant_id != null);
    const merged: OverrideCategoryRow = {
      ...(existing ? parseOverrideRow(existing) : { active: true }),
      ...pickDefined(input),
    };
    assertOverrideTightens(base, merged);

    await this.db.execute(sql`
      insert into commons_file_category
        (key, tenant_id, source, active, allowed_content_types, max_size_bytes, min_size_bytes,
         allowed_extensions, on_unscannable, signed_link_expiry_seconds, updated_at)
      values
        (${key}, ${tenantId}, 'tenant', ${merged.active ?? true},
         ${arrayOrNull(merged.allowedContentTypes)}, ${merged.maxSizeBytes ?? null}, ${merged.minSizeBytes ?? null},
         ${arrayOrNull(merged.allowedExtensions ?? null)}, ${merged.onUnscannable ?? null},
         ${merged.signedLinkExpirySeconds ?? null}, now())
      on conflict (key, tenant_id) where tenant_id is not null do update set
        active = excluded.active,
        allowed_content_types = excluded.allowed_content_types,
        max_size_bytes = excluded.max_size_bytes,
        min_size_bytes = excluded.min_size_bytes,
        allowed_extensions = excluded.allowed_extensions,
        on_unscannable = excluded.on_unscannable,
        signed_link_expiry_seconds = excluded.signed_link_expiry_seconds,
        updated_at = now()
    `);
    this.cache.clear();
    return (await this.getCategory(tenantId, key))!;
  }

  async deactivateCategory(tenantId: string | null, key: string): Promise<void> {
    if (tenantId === null) {
      await this.db.execute(sql`
        update commons_file_category set active = false, updated_at = now()
        where key = ${key} and tenant_id is null
      `);
    } else {
      await this.db.execute(sql`
        insert into commons_file_category (key, tenant_id, source, active, updated_at)
        values (${key}, ${tenantId}, 'tenant', false, now())
        on conflict (key, tenant_id) where tenant_id is not null
        do update set active = false, updated_at = now()
      `);
    }
    this.cache.clear();
  }

  private toView(
    key: string,
    baseRow: Record<string, unknown>,
    overrideRow: Record<string, unknown> | undefined,
  ): FileCategoryView {
    const base = parseBaseRow(baseRow);
    const override = overrideRow ? parseOverrideRow(overrideRow) : null;
    return {
      key,
      base: {
        key: base.key,
        label: base.label,
        description: base.description,
        bucket: base.bucket,
        allowedContentTypes: base.allowedContentTypes,
        maxSizeBytes: base.maxSizeBytes,
        minSizeBytes: base.minSizeBytes,
        allowedExtensions: base.allowedExtensions,
        onUnscannable: base.onUnscannable,
        signedLinkExpirySeconds: base.signedLinkExpirySeconds,
        retention: base.retention,
        active: base.active,
      },
      override: override
        ? {
            allowedContentTypes: override.allowedContentTypes,
            maxSizeBytes: override.maxSizeBytes,
            minSizeBytes: override.minSizeBytes,
            allowedExtensions: override.allowedExtensions,
            onUnscannable: override.onUnscannable,
            signedLinkExpirySeconds: override.signedLinkExpirySeconds,
            active: override.active,
          }
        : null,
      effective: mergeCategory(base, override),
    };
  }
}

function pickDefined(input: FileCategoryOverrideInput): Partial<OverrideCategoryRow> {
  const out: Partial<OverrideCategoryRow> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function arrayOrNull(v: string[] | null | undefined) {
  return v && v.length > 0 ? textArray(v) : null;
}
