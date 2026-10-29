import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { FileRecord, FileRetentionStore, FileRetentionVolume } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { toFileRecord } from '../persistence/row-mappers';
import { textArray } from '../persistence/sql-helpers';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

/**
 * `FileRetentionStore` on Postgres. The finds read the partial
 * `retain_until` index (migration 0006); the log prunes read the
 * `occurred_at` indexes (0004, 0005) and delete in batches, so a backlog never
 * holds one long lock on a table the recorders write.
 */
@Injectable()
export class PostgresFileRetentionStore implements FileRetentionStore {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async findExpiredFiles(now: Date, limit: number): Promise<FileRecord[]> {
    const { rows } = await this.db.execute(sql`
      select * from commons_file_record
      where retain_until is not null and retain_until <= ${now} and held_at is null
      order by retain_until, id
      limit ${limit}
    `);
    return rows.map(toFileRecord);
  }

  async findPurgeableOrphans(query: { olderThan: Date; now: Date; tenantId?: string; limit: number }): Promise<FileRecord[]> {
    const { rows } = await this.db.execute(sql`
      select f.* from commons_file_record f
      where f.created_at < ${query.olderThan}
        and f.held_at is null
        and (f.retain_until is null or f.retain_until <= ${query.now})
        ${query.tenantId !== undefined ? sql`and f.tenant_id = ${query.tenantId}` : sql``}
        and not exists (select 1 from commons_attachment a where a.file_record_id = f.id)
      order by f.created_at, f.id
      limit ${query.limit}
    `);
    return rows.map(toFileRecord);
  }

  async findRecordedRefs(fileRefs: string[]): Promise<Set<string>> {
    if (fileRefs.length === 0) return new Set();
    const { rows } = await this.db.execute(sql`
      select file_ref from commons_file_record where file_ref = any(${textArray(fileRefs)})
    `);
    return new Set(rows.map((r) => r.file_ref as string));
  }

  async pruneAccessLog(before: Date, batchSize: number): Promise<number> {
    return this.inBatches(batchSize, (limit) => sql`
      with doomed as (select id from commons_file_access where occurred_at < ${before} limit ${limit})
      delete from commons_file_access where id in (select id from doomed) returning id
    `);
  }

  async pruneRejections(before: Date, batchSize: number): Promise<number> {
    return this.inBatches(batchSize, (limit) => sql`
      with doomed as (select id from commons_file_rejection where occurred_at < ${before} limit ${limit})
      delete from commons_file_rejection where id in (select id from doomed) returning id
    `);
  }

  async volume(now: Date, tenantId?: string): Promise<FileRetentionVolume> {
    const soon = new Date(now.getTime() + 30 * 86_400_000);
    const where = tenantId !== undefined ? sql`where tenant_id = ${tenantId}` : sql``;
    const [files, access, rejections] = await Promise.all([
      this.db.execute(sql`
        select count(*) as count,
          coalesce(sum(size_bytes), 0) as total_bytes,
          count(*) filter (where retain_until <= ${now} and held_at is null) as past_retention,
          count(*) filter (where retain_until > ${now} and retain_until <= ${soon}) as expiring_soon,
          count(*) filter (where retain_until is null) as indefinite,
          count(*) filter (where held_at is not null) as held,
          min(created_at) as oldest
        from commons_file_record ${where}
      `),
      this.db.execute(sql`select count(*) as rows, min(occurred_at) as oldest from commons_file_access ${where}`),
      this.db.execute(sql`select count(*) as rows, min(occurred_at) as oldest from commons_file_rejection ${where}`),
    ]);
    const f = files.rows[0] ?? {};
    const date = (v: unknown) => (v ? new Date(v as string) : null);
    return {
      files: {
        count: Number(f.count ?? 0),
        totalBytes: Number(f.total_bytes ?? 0),
        pastRetention: Number(f.past_retention ?? 0),
        expiringWithin30Days: Number(f.expiring_soon ?? 0),
        indefinite: Number(f.indefinite ?? 0),
        held: Number(f.held ?? 0),
        oldestCreatedAt: date(f.oldest),
      },
      accessLog: { rows: Number(access.rows[0]?.rows ?? 0), oldestAt: date(access.rows[0]?.oldest) },
      rejections: { rows: Number(rejections.rows[0]?.rows ?? 0), oldestAt: date(rejections.rows[0]?.oldest) },
    };
  }

  private async inBatches(batchSize: number, statement: (limit: number) => SQL): Promise<number> {
    const limit = Math.max(1, Math.floor(batchSize));
    let total = 0;
    for (;;) {
      const { rows } = await this.db.execute(statement(limit));
      total += rows.length;
      if (rows.length < limit) return total;
    }
  }
}
