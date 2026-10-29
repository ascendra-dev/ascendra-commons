import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { StorageQuotaStore, TenantQuota, TenantQuotaUsage } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

const toQuota = (r: Record<string, unknown>): TenantQuota => ({
  tenantId: r.tenant_id as string,
  maxBytes: Number(r.max_bytes),
  updatedAt: new Date(r.updated_at as string),
  updatedBy: r.updated_by as string,
});

/**
 * `StorageQuotaStore` on Postgres — `commons_file_tenant_quota` (migration
 * 0007). Usage is `SUM(size_bytes)` over the tenant's records, an index-only
 * scan of `commons_file_record_tenant_size_idx`.
 */
@Injectable()
export class PostgresStorageQuotaStore implements StorageQuotaStore {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async getQuota(tenantId: string): Promise<TenantQuota | null> {
    const { rows } = await this.db.execute(sql`select * from commons_file_tenant_quota where tenant_id = ${tenantId}`);
    return rows[0] ? toQuota(rows[0]) : null;
  }

  async usage(tenantId: string): Promise<number> {
    const { rows } = await this.db.execute(
      sql`select coalesce(sum(size_bytes), 0) as used from commons_file_record where tenant_id = ${tenantId}`,
    );
    return Number(rows[0]?.used ?? 0);
  }

  async setQuota(tenantId: string, maxBytes: number, updatedBy: string): Promise<TenantQuota> {
    const { rows } = await this.db.execute(sql`
      insert into commons_file_tenant_quota (tenant_id, max_bytes, updated_by)
      values (${tenantId}, ${maxBytes}, ${updatedBy})
      on conflict (tenant_id) do update set max_bytes = excluded.max_bytes, updated_by = excluded.updated_by, updated_at = now()
      returning *
    `);
    return toQuota(rows[0]);
  }

  async clearQuota(tenantId: string): Promise<TenantQuota | null> {
    const { rows } = await this.db.execute(sql`delete from commons_file_tenant_quota where tenant_id = ${tenantId} returning *`);
    return rows[0] ? toQuota(rows[0]) : null;
  }

  async listQuotas(tenantId?: string): Promise<TenantQuotaUsage[]> {
    const { rows } = await this.db.execute(sql`
      select q.*, coalesce(u.used, 0) as used_bytes, coalesce(u.files, 0) as file_count
      from commons_file_tenant_quota q
      left join lateral (
        select sum(size_bytes) as used, count(*) as files from commons_file_record f where f.tenant_id = q.tenant_id
      ) u on true
      ${tenantId !== undefined ? sql`where q.tenant_id = ${tenantId}` : sql``}
      order by q.tenant_id
    `);
    return rows.map((r) => ({ ...toQuota(r), usedBytes: Number(r.used_bytes), fileCount: Number(r.file_count) }));
  }
}
