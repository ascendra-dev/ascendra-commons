import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type FileAccessLogPage,
  type FileDetail,
  type FileInventoryPage,
  type FileInventoryQuery,
  type FileStorageObservabilityPort,
  type OrphanedFilePage,
  type OrphanedFileQuery,
  type StorageUsageQuery,
  type StorageUsageRow,
  type CategoryUsageRow,
} from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { toAttachment, toFileRecord } from '../persistence/row-mappers';
import { FILE_STORAGE_SQL_EXECUTOR } from '../tokens';

const and = (parts: SQL[]): SQL =>
  parts.length === 0 ? sql`true` : sql.join(parts, sql` and `);

@Injectable()
export class PostgresFileStorageObservabilityService implements FileStorageObservabilityPort {
  constructor(@Inject(FILE_STORAGE_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async listFiles(query: FileInventoryQuery = {}): Promise<FileInventoryPage> {
    const limit = clampLimit(query.limit);
    const where: SQL[] = [];
    if (query.tenantId) where.push(sql`f.tenant_id = ${query.tenantId}`);
    if (query.category) where.push(sql`f.category = ${query.category}`);
    if (query.uploadedBy) where.push(sql`f.uploaded_by = ${query.uploadedBy}`);
    if (query.uploadedAfter) where.push(sql`f.created_at >= ${query.uploadedAfter}`);
    if (query.uploadedBefore) where.push(sql`f.created_at <= ${query.uploadedBefore}`);
    if (query.minSizeBytes !== undefined) where.push(sql`f.size_bytes >= ${query.minSizeBytes}`);
    const cur = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cur) where.push(sql`(f.created_at, f.id) < (${cur.timestamp}, ${cur.id})`);

    const { rows } = await this.db.execute(sql`
      select f.*, (select count(*) from commons_attachment a where a.file_record_id = f.id) as attachment_count
      from commons_file_record f
      where ${and(where)}
      order by f.created_at desc, f.id desc
      limit ${limit + 1}
    `);

    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        category: r.category as string,
        contentType: r.content_type as string,
        sizeBytes: Number(r.size_bytes),
        uploadedBy: r.uploaded_by as string,
        createdAt: new Date(r.created_at as string),
        attachmentCount: Number(r.attachment_count),
      })),
      nextCursor:
        rows.length > limit
          ? encodeKeysetCursor(new Date(page[page.length - 1].created_at as string), page[page.length - 1].id as string)
          : null,
    };
  }

  async getFile(id: string): Promise<FileDetail | null> {
    const { rows } = await this.db.execute(sql`select * from commons_file_record where id = ${id}`);
    if (!rows[0]) return null;
    const { rows: attachments } = await this.db.execute(
      sql`select * from commons_attachment where file_record_id = ${id} order by created_at asc`,
    );
    return { fileRecord: toFileRecord(rows[0]), attachments: attachments.map(toAttachment) };
  }

  async storageUsage(query: StorageUsageQuery = {}): Promise<StorageUsageRow[]> {
    const where = query.tenantId ? sql`where tenant_id = ${query.tenantId}` : sql``;
    const { rows } = await this.db.execute(sql`
      select tenant_id, category, count(*) as file_count, coalesce(sum(size_bytes), 0) as total_bytes
      from commons_file_record ${where}
      group by tenant_id, category
      order by total_bytes desc
    `);
    return rows.map((r) => ({
      tenantId: r.tenant_id as string,
      category: r.category as string,
      fileCount: Number(r.file_count),
      totalBytes: Number(r.total_bytes),
    }));
  }

  async listOrphanedFileRecords(query: OrphanedFileQuery = {}): Promise<OrphanedFilePage> {
    const limit = clampLimit(query.limit);
    const where: SQL[] = [sql`a.id is null`];
    if (query.tenantId) where.push(sql`f.tenant_id = ${query.tenantId}`);
    if (query.olderThan) where.push(sql`f.created_at < ${query.olderThan}`);
    const cur = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cur) where.push(sql`(f.created_at, f.id) < (${cur.timestamp}, ${cur.id})`);

    const { rows } = await this.db.execute(sql`
      select f.id, f.tenant_id, f.category, f.file_ref, f.size_bytes, f.created_at
      from commons_file_record f
      left join commons_attachment a on a.file_record_id = f.id
      where ${and(where)}
      order by f.created_at desc, f.id desc
      limit ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        category: r.category as string,
        fileRef: r.file_ref as string,
        sizeBytes: Number(r.size_bytes),
        createdAt: new Date(r.created_at as string),
      })),
      nextCursor:
        rows.length > limit
          ? encodeKeysetCursor(new Date(page[page.length - 1].created_at as string), page[page.length - 1].id as string)
          : null,
    };
  }

  async getAccessLog(
    fileRecordId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<FileAccessLogPage> {
    const limit = clampLimit(opts.limit);
    const where: SQL[] = [sql`file_record_id = ${fileRecordId}`];
    const cur = opts.cursor ? decodeKeysetCursor(opts.cursor) : null;
    if (cur) where.push(sql`(occurred_at, id) < (${cur.timestamp}, ${cur.id})`);

    const { rows } = await this.db.execute(sql`
      select id, actor_id, via, purpose, occurred_at from commons_file_access
      where ${and(where)}
      order by occurred_at desc, id desc
      limit ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({
        id: r.id as string,
        actorId: (r.actor_id as string | null) ?? null,
        via: r.via as 'actor' | 'signed-link',
        purpose: r.purpose as string,
        occurredAt: new Date(r.occurred_at as string),
      })),
      nextCursor:
        rows.length > limit
          ? encodeKeysetCursor(new Date(page[page.length - 1].occurred_at as string), page[page.length - 1].id as string)
          : null,
    };
  }

  async categoryUsage(tenantId?: string): Promise<CategoryUsageRow[]> {
    const where = tenantId ? sql`where tenant_id = ${tenantId}` : sql``;
    const { rows } = await this.db.execute(sql`
      select category, count(*) as file_count, coalesce(sum(size_bytes), 0) as total_bytes, max(created_at) as last_uploaded_at
      from commons_file_record ${where}
      group by category
      order by category
    `);
    return rows.map((r) => ({
      key: r.category as string,
      fileCount: Number(r.file_count),
      totalBytes: Number(r.total_bytes),
      lastUploadedAt: r.last_uploaded_at ? new Date(r.last_uploaded_at as string) : null,
    }));
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return 50;
  return Math.min(limit, 200);
}
