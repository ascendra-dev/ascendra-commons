import type { Attachment } from './attachment.interface';
import type { FileCategory, ResolvedFileCategory } from './file-category';
import type { FileRecord } from './file-record.interface';
import type { FileUploadRejectionReason } from './file-upload-rejection-recorder.port';

/* ─── inventory ─────────────────────────────────────────────────────────── */

export interface FileInventoryQuery {
  /** Forced to the actor's own tenant for a non-platform admin by `file-storage.api`. */
  tenantId?: string;
  category?: string;
  uploadedBy?: string;
  uploadedAfter?: Date;
  uploadedBefore?: Date;
  minSizeBytes?: number;
  /** `true` → only files under legal hold; `false` → only files not held. */
  held?: boolean;
  /** Case-insensitive substring of the stored filename. */
  search?: string;
  /** What the scanner said — `unscannable` finds files stored though the scanner couldn't read them. */
  scanVerdict?: 'clean' | 'unscannable';
  limit?: number;
  /** A cursor this list issued — anything else throws `InvalidFileCursorError`. */
  cursor?: string;
}

export interface FileInventoryRow {
  id: string;
  tenantId: string;
  category: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  filename: string | null;
  scanVerdict: 'clean' | 'unscannable' | null;
  retainUntil: Date | null;
  /** When a legal hold was placed — `null` when not held. */
  heldAt: Date | null;
  createdAt: Date;
  attachmentCount: number;
}

export interface FileInventoryPage {
  rows: FileInventoryRow[];
  nextCursor: string | null;
}

/* ─── one file ─────────────────────────────────────────────────────────── */

export interface FileDetail {
  fileRecord: FileRecord;
  attachments: Attachment[];
}

/* ─── storage usage ───────────────────────────────────────────────────── */

export interface StorageUsageQuery {
  tenantId?: string;
}

export interface StorageUsageRow {
  tenantId: string;
  category: string;
  fileCount: number;
  totalBytes: number;
}

/* ─── orphans (FileRecords with zero Attachments) ─────────────────────── */

export interface OrphanedFileQuery {
  tenantId?: string;
  /** Only records older than this — a just-uploaded record mid-`attach` is briefly attachment-less. */
  olderThan?: Date;
  limit?: number;
  cursor?: string;
}

export interface OrphanedFileRow {
  id: string;
  tenantId: string;
  category: string;
  fileRef: string;
  filename: string | null;
  sizeBytes: number;
  createdAt: Date;
}

export interface OrphanedFilePage {
  rows: OrphanedFileRow[];
  nextCursor: string | null;
}

/* ─── access log ──────────────────────────────────────────────────────── */

export interface FileAccessLogEntry {
  id: string;
  actorId: string | null;
  via: 'actor' | 'signed-link';
  purpose: string;
  occurredAt: Date;
}

export interface FileAccessLogPage {
  rows: FileAccessLogEntry[];
  nextCursor: string | null;
}

/* ─── per-category usage (for the catalog screen) ─────────────────────── */

export interface CategoryUsageRow {
  key: string;
  fileCount: number;
  totalBytes: number;
  lastUploadedAt: Date | null;
}

/* ─── stats (Overview screen) ─────────────────────────────────────────── */

export interface FileStatsQuery {
  /** Forced to the actor's own tenant for a non-platform actor by `file-storage.api`. */
  tenantId?: string;
  /** Whole calendar days in `timeZone`, ending today. Default 30. */
  windowDays?: number;
  /** IANA zone the days are counted in — the viewer's. Default `UTC`. */
  timeZone?: string;
}

export interface FileStatsDay {
  /** `YYYY-MM-DD` in the query's time zone. Every day of the window is present, a quiet one at 0. */
  date: string;
  uploads: number;
  bytes: number;
  rejected: number;
}

export interface CategoryStatsRow {
  category: string;
  fileCount: number;
  totalBytes: number;
  rejected: number;
}

/**
 * Uploads and refusals over a window of whole calendar days in the viewer's
 * zone — the Overview screen. Each count is over the same window and tenant,
 * so a tile and the list it links to agree.
 */
export interface FileStatsSummary {
  since: Date;
  until: Date;
  totals: { uploads: number; bytes: number; rejected: number; unscannable: number };
  byDay: FileStatsDay[];
  byCategory: CategoryStatsRow[];
  /** `unknown` — rows written before the scan verdict was recorded. */
  byScanVerdict: Array<{ verdict: 'clean' | 'unscannable' | 'unknown'; count: number }>;
  byRejectionReason: Array<{ reason: FileUploadRejectionReason; count: number }>;
}

/* ─── duplicates ──────────────────────────────────────────────────────── */

export interface DuplicateFilesQuery {
  /** Forced to the actor's own tenant for a non-platform actor by `file-storage.api`. */
  tenantId?: string;
  /** How many groups. Default 50, at most 200. */
  limit?: number;
}

/**
 * Files in one tenant with the same bytes (same SHA-256). Reported, never
 * merged: each file is its own record with its own attachments, retention
 * and hold — merging would make one delete remove both.
 */
export interface DuplicateFileGroup {
  tenantId: string;
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  /** Bytes beyond the first copy — what keeping one would save. */
  wastedBytes: number;
  /** Up to 10, oldest first. */
  fileIds: string[];
  firstUploadedAt: Date;
  lastUploadedAt: Date;
}

/* ─── rejected uploads ─────────────────────────────────────────────────── */

export interface FileRejectionQuery {
  /** Forced to the actor's own tenant for a non-platform actor by `file-storage.api`. */
  tenantId?: string;
  category?: string;
  reason?: FileUploadRejectionReason;
  /** Refused at or after this instant. */
  occurredAfter?: Date;
  /** Refused before this instant (exclusive) — with `occurredAfter`, the same window the stats counted. */
  occurredBefore?: Date;
  limit?: number;
  cursor?: string;
}

export interface FileRejectionRow {
  id: string;
  tenantId: string;
  actorId: string;
  category: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  reason: FileUploadRejectionReason;
  message: string;
  occurredAt: Date;
}

export interface FileRejectionPage {
  rows: FileRejectionRow[];
  nextCursor: string | null;
}

/* ─── category admin ──────────────────────────────────────────────────── */

/**
 * The tunable subset a tenant admin may override. Every field optional; a set
 * field must be *no less restrictive* than the base. `null` clears that field's
 * override — the tenant inherits the base value again.
 */
export interface FileCategoryOverrideInput {
  allowedContentTypes?: string[] | null;
  maxSizeBytes?: number | null;
  minSizeBytes?: number | null;
  allowedExtensions?: string[] | null;
  onUnscannable?: 'reject' | 'allow' | null;
  signedLinkExpirySeconds?: number | null;
  active?: boolean;
}

export interface FileCategoryView {
  key: string;
  base: FileCategory & { active: boolean };
  /** The caller's tenant override, if any. `null` for the base-only view a platform admin sees. */
  override: (FileCategoryOverrideInput & { active: boolean }) | null;
  /** Base merged with the override — what `attach` would enforce for this tenant. */
  effective: ResolvedFileCategory;
}

export class CategoryNotFoundError extends Error {
  constructor(key: string) {
    super(`no file category '${key}'`);
    this.name = 'CategoryNotFoundError';
  }
}

/** A tenant override value that can't be a rule at all — a size of 0, an empty list, a minimum above the maximum. */
export class CategoryOverrideInvalidError extends Error {
  constructor(
    readonly field: string,
    reason: string,
  ) {
    super(`file category override '${field}' ${reason}`);
    this.name = 'CategoryOverrideInvalidError';
  }
}

/** A tenant override tried to loosen a rule past the base (or past the app-global validator). */
export class CategoryLooseningNotAllowedError extends Error {
  constructor(field: string) {
    super(`file category override for '${field}' may only be more restrictive than the base definition`);
    this.name = 'CategoryLooseningNotAllowedError';
  }
}
