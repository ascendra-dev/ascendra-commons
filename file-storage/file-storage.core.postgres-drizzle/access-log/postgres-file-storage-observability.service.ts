import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  encodeKeysetCursor,
  requireKeysetCursor,
  type FileAccessLogPage,
  type FileDetail,
  type FileInventoryPage,
  type FileInventoryQuery,
  type FileRejectionPage,
  type FileRejectionQuery,
  type FileStatsQuery,
  type FileStatsSummary,
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

/** A timestamp column as the cursor's key — UTC, at the column's microsecond precision (a JS Date keeps ms). */
const key = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The keyset condition for a newest-first page: the row comes after the cursor's (timestamp, id). */
const after = (tsColumn: SQL, idColumn: SQL, cursor: string): SQL => {
  const c = requireKeysetCursor(cursor);
  return sql`(${tsColumn}, ${idColumn}) < (${c.timestamp}::timestamptz, ${c.id}::uuid)`;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

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
    if (query.held !== undefined) where.push(query.held ? sql`f.held_at is not null` : sql`f.held_at is null`);
    if (query.search) where.push(sql`f.filename ilike ${`%${escapeLike(query.search)}%`}`);
    if (query.cursor) where.push(after(sql`f.created_at`, sql`f.id`, query.cursor));

    const { rows } = await this.db.execute(sql`
      select f.*, ${key(sql`f.created_at`)} as created_at_key,
        (select count(*) from commons_attachment a where a.file_record_id = f.id) as attachment_count
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
        filename: (r.filename as string | null) ?? null,
        scanVerdict: (r.scan_verdict as 'clean' | 'unscannable' | null) ?? null,
        retainUntil: r.retain_until ? new Date(r.retain_until as string) : null,
        heldAt: r.held_at ? new Date(r.held_at as string) : null,
        createdAt: new Date(r.created_at as string),
        attachmentCount: Number(r.attachment_count),
      })),
      nextCursor: nextCursor(rows, limit, 'created_at_key'),
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
    if (query.cursor) where.push(after(sql`f.created_at`, sql`f.id`, query.cursor));

    const { rows } = await this.db.execute(sql`
      select f.id, f.tenant_id, f.category, f.file_ref, f.size_bytes, f.created_at, f.filename,
        ${key(sql`f.created_at`)} as created_at_key
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
        filename: (r.filename as string | null) ?? null,
        sizeBytes: Number(r.size_bytes),
        createdAt: new Date(r.created_at as string),
      })),
      nextCursor: nextCursor(rows, limit, 'created_at_key'),
    };
  }

  async getAccessLog(
    fileRecordId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<FileAccessLogPage> {
    const limit = clampLimit(opts.limit);
    const where: SQL[] = [sql`file_record_id = ${fileRecordId}`];
    if (opts.cursor) where.push(after(sql`occurred_at`, sql`id`, opts.cursor));

    const { rows } = await this.db.execute(sql`
      select id, actor_id, via, purpose, occurred_at, ${key(sql`occurred_at`)} as occurred_at_key from commons_file_access
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
      nextCursor: nextCursor(rows, limit, 'occurred_at_key'),
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

  /**
   * Uploads-over-time + by-category counts for the ops Overview screen, both
   * windowed by `query.windowDays` (default 30). Deliberately no scan-verdict
   * breakdown — `commons_file_record` has no `scan_verdict` column; adding one
   * is a schema migration, out of scope here.
   */
  async statsSummary(query: FileStatsQuery = {}): Promise<FileStatsSummary> {
    const windowDays = query.windowDays && query.windowDays > 0 ? query.windowDays : 30;
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const where: SQL[] = [sql`created_at >= ${cutoff}`];
    if (query.tenantId) where.push(sql`tenant_id = ${query.tenantId}`);

    const [{ rows: dayRows }, { rows: categoryRows }] = await Promise.all([
      this.db.execute(sql`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*) as count
        from commons_file_record
        where ${and(where)}
        group by day
        order by day asc
      `),
      this.db.execute(sql`
        select category, count(*) as file_count, coalesce(sum(size_bytes), 0) as total_bytes
        from commons_file_record
        where ${and(where)}
        group by category
        order by category
      `),
    ]);

    return {
      uploadsByDay: dayRows.map((r) => ({ date: r.day as string, count: Number(r.count) })),
      byCategory: categoryRows.map((r) => ({
        category: r.category as string,
        fileCount: Number(r.file_count),
        totalBytes: Number(r.total_bytes),
      })),
    };
  }

  async listRejections(query: FileRejectionQuery = {}): Promise<FileRejectionPage> {
    const limit = clampLimit(query.limit);
    const where: SQL[] = [];
    if (query.tenantId) where.push(sql`tenant_id = ${query.tenantId}`);
    if (query.category) where.push(sql`category = ${query.category}`);
    if (query.reason) where.push(sql`reason = ${query.reason}`);
    if (query.cursor) where.push(after(sql`occurred_at`, sql`id`, query.cursor));

    const { rows } = await this.db.execute(sql`
      select id, tenant_id, actor_id, category, filename, content_type, size_bytes, reason, message, occurred_at,
        ${key(sql`occurred_at`)} as occurred_at_key
      from commons_file_rejection
      where ${and(where)}
      order by occurred_at desc, id desc
      limit ${limit + 1}
    `);

    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({
        id: r.id as string,
        tenantId: r.tenant_id as string,
        actorId: r.actor_id as string,
        category: r.category as string,
        filename: r.filename as string,
        contentType: r.content_type as string,
        sizeBytes: Number(r.size_bytes),
        reason: r.reason as 'category-unavailable' | 'validation-failed' | 'scan-rejected',
        message: r.message as string,
        occurredAt: new Date(r.occurred_at as string),
      })),
      nextCursor: nextCursor(rows, limit, 'occurred_at_key'),
    };
  }
}

/** The cursor for the page after this one — from its last row's microsecond key — or `null` on the last page. */
function nextCursor(rows: Array<Record<string, unknown>>, limit: number, keyColumn: string): string | null {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1];
  return encodeKeysetCursor(last[keyColumn] as string, last.id as string);
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return 50;
  return Math.min(limit, 200);
}
