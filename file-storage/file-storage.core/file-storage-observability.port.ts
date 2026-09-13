import type {
  CategoryUsageRow,
  FileAccessLogPage,
  FileDetail,
  FileInventoryPage,
  FileInventoryQuery,
  FileRejectionPage,
  FileRejectionQuery,
  FileStatsQuery,
  FileStatsSummary,
  OrphanedFilePage,
  OrphanedFileQuery,
  StorageUsageQuery,
  StorageUsageRow,
} from './file-storage-admin.types';

/**
 * Read-only reporting for an ops / compliance file-inventory screen. Bound
 * under `FILE_STORAGE_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `file-storage.api`. Never mutates.
 *
 * Does not generate download URLs — `file-storage.api` layers those on via
 * `AttachmentService` so the access log and expiry rules still apply.
 */
export interface FileStorageObservabilityPort {
  /** File records, newest first, keyset-paginated. */
  listFiles(query?: FileInventoryQuery): Promise<FileInventoryPage>;

  /** One file's record + its attachments, or `null`. */
  getFile(id: string): Promise<FileDetail | null>;

  /** `SUM(size_bytes)` / `COUNT(*)` grouped by `(tenant_id, category)`. */
  storageUsage(query?: StorageUsageQuery): Promise<StorageUsageRow[]>;

  /** File records with zero attachments — cleanup candidates. */
  listOrphanedFileRecords(query?: OrphanedFileQuery): Promise<OrphanedFilePage>;

  /** The download access log for one file, newest first, keyset-paginated. */
  getAccessLog(fileRecordId: string, opts?: { limit?: number; cursor?: string }): Promise<FileAccessLogPage>;

  /** Per-category counts for the catalog screen (`tenantId` omitted → all tenants, platform-admin only). */
  categoryUsage(tenantId?: string): Promise<CategoryUsageRow[]>;

  /**
   * Uploads-over-time + by-category counts for the ops Overview screen, both
   * windowed by `query.windowDays`. No scan-verdict breakdown — deferred,
   * see `FileStatsSummary`.
   */
  statsSummary(query?: FileStatsQuery): Promise<FileStatsSummary>;

  /** Rejected upload attempts (bad category, validation failure, failed/rejected scan), newest first, keyset-paginated. */
  listRejections(query?: FileRejectionQuery): Promise<FileRejectionPage>;
}

/** Bound by the stack adapter (`file-storage.core.postgres-drizzle`). */
export const FILE_STORAGE_OBSERVABILITY_PORT = Symbol('FILE_STORAGE_OBSERVABILITY_PORT');
