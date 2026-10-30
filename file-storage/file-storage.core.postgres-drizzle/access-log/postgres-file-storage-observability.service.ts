import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  calendarDays,
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
  type DuplicateFileGroup,
  type DuplicateFilesQuery,
  type FileUploadRejectionReason,
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
    if (query.scanVerdict) where.push(sql`f.scan_verdict = ${query.scanVerdict}`);
    if (query.cursor) where.push(after(sql`f.created_at`, sql`f.id`, query.cursor));

    const { rows } = await this.db.execute(sql`
      select f.*, ${key(sql`f.created_at`)} as created_at_key,
        (select count(*) from commons_file_attachment a where a.file_record_id = f.id) as attachment_count
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
      sql`select * from commons_file_attachment where file_record_id = ${id} order by created_at asc`,
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
      left join commons_file_attachment a on a.file_record_id = f.id
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
   * The Overview: whole calendar days in the viewer's zone (a per-day chart
   * over a rolling window would open on a partial day), from the first day's
   * local midnight to now. Uploads by day / category / scan verdict, and
   * refusals by day / category / reason — all over that one window.
   */
  async statsSummary(query: FileStatsQuery = {}, now: Date = new Date()): Promise<FileStatsSummary> {
    const timeZone = query.timeZone ?? 'UTC';
    const days = calendarDays(now, query.windowDays && query.windowDays > 0 ? query.windowDays : 30, timeZone);
    const { rows: sinceRows } = await this.db.execute(sql`select (${days[0]}::date::timestamp at time zone ${timeZone}) as since`);
    const since = new Date(sinceRows[0].since as string);

    const tenant = query.tenantId !== undefined ? sql`and tenant_id = ${query.tenantId}` : sql``;
    const files = sql`created_at >= ${since} and created_at < ${now} ${tenant}`;
    const refusals = sql`occurred_at >= ${since} and occurred_at < ${now} ${tenant}`;

    const [uploadDays, refusalDays, categories, refusedCategories, verdicts, reasons] = await Promise.all([
      this.db.execute(sql`
        select to_char(created_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*) as uploads, coalesce(sum(size_bytes), 0) as bytes
        from commons_file_record where ${files} group by 1
      `),
      this.db.execute(sql`
        select to_char(occurred_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*) as rejected
        from commons_file_rejection where ${refusals} group by 1
      `),
      this.db.execute(sql`
        select category, count(*) as file_count, coalesce(sum(size_bytes), 0) as total_bytes
        from commons_file_record where ${files} group by category
      `),
      this.db.execute(sql`select category, count(*) as rejected from commons_file_rejection where ${refusals} group by category`),
      this.db.execute(sql`
        select coalesce(scan_verdict, 'unknown') as verdict, count(*) as count
        from commons_file_record where ${files} group by 1 order by 2 desc
      `),
      this.db.execute(sql`select reason, count(*) as count from commons_file_rejection where ${refusals} group by reason order by 2 desc, 1`),
    ]);

    const up = new Map(uploadDays.rows.map((r) => [r.day as string, { uploads: Number(r.uploads), bytes: Number(r.bytes) }]));
    const rej = new Map(refusalDays.rows.map((r) => [r.day as string, Number(r.rejected)]));
    const byDay = days.map((date) => ({ date, uploads: up.get(date)?.uploads ?? 0, bytes: up.get(date)?.bytes ?? 0, rejected: rej.get(date) ?? 0 }));

    const cats = new Map<string, { category: string; fileCount: number; totalBytes: number; rejected: number }>();
    for (const r of categories.rows) {
      cats.set(r.category as string, { category: r.category as string, fileCount: Number(r.file_count), totalBytes: Number(r.total_bytes), rejected: 0 });
    }
    for (const r of refusedCategories.rows) {
      const key = r.category as string;
      const row = cats.get(key) ?? { category: key, fileCount: 0, totalBytes: 0, rejected: 0 };
      row.rejected = Number(r.rejected);
      cats.set(key, row);
    }
    const byScanVerdict = verdicts.rows.map((r) => ({ verdict: r.verdict as 'clean' | 'unscannable' | 'unknown', count: Number(r.count) }));

    return {
      since,
      until: now,
      totals: {
        uploads: byDay.reduce((n, d) => n + d.uploads, 0),
        bytes: byDay.reduce((n, d) => n + d.bytes, 0),
        rejected: byDay.reduce((n, d) => n + d.rejected, 0),
        unscannable: byScanVerdict.find((v) => v.verdict === 'unscannable')?.count ?? 0,
      },
      byDay,
      byCategory: [...cats.values()].sort((a, b) => a.category.localeCompare(b.category)),
      byScanVerdict,
      byRejectionReason: reasons.rows.map((r) => ({ reason: r.reason as FileStatsSummary['byRejectionReason'][number]['reason'], count: Number(r.count) })),
    };
  }

  async listDuplicates(query: DuplicateFilesQuery = {}): Promise<DuplicateFileGroup[]> {
    const { rows } = await this.db.execute(sql`
      select tenant_id, content_hash, count(*) as file_count, sum(size_bytes) as total_bytes,
        sum(size_bytes) - min(size_bytes) as wasted_bytes,
        (array_agg(id order by created_at, id))[1:10] as file_ids,
        min(created_at) as first_at, max(created_at) as last_at
      from commons_file_record
      where content_hash is not null ${query.tenantId !== undefined ? sql`and tenant_id = ${query.tenantId}` : sql``}
      group by tenant_id, content_hash
      having count(*) > 1
      order by wasted_bytes desc, tenant_id, content_hash
      limit ${clampLimit(query.limit)}
    `);
    return rows.map((r) => ({
      tenantId: r.tenant_id as string,
      contentHash: r.content_hash as string,
      fileCount: Number(r.file_count),
      totalBytes: Number(r.total_bytes),
      wastedBytes: Number(r.wasted_bytes),
      fileIds: r.file_ids as string[],
      firstUploadedAt: new Date(r.first_at as string),
      lastUploadedAt: new Date(r.last_at as string),
    }));
  }

  async listRejections(query: FileRejectionQuery = {}): Promise<FileRejectionPage> {
    const limit = clampLimit(query.limit);
    const where: SQL[] = [];
    if (query.tenantId) where.push(sql`tenant_id = ${query.tenantId}`);
    if (query.category) where.push(sql`category = ${query.category}`);
    if (query.reason) where.push(sql`reason = ${query.reason}`);
    if (query.occurredAfter) where.push(sql`occurred_at >= ${query.occurredAfter}`);
    if (query.occurredBefore) where.push(sql`occurred_at < ${query.occurredBefore}`);
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
        reason: r.reason as FileUploadRejectionReason,
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
