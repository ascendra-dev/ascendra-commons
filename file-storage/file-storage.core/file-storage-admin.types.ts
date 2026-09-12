import type { Attachment } from './attachment.interface';
import type { FileCategory, ResolvedFileCategory } from './file-category';
import type { FileRecord } from './file-record.interface';

/* ─── inventory ─────────────────────────────────────────────────────────── */

export interface FileInventoryQuery {
  /** Forced to the actor's own tenant for a non-platform admin by `file-storage.api`. */
  tenantId?: string;
  category?: string;
  uploadedBy?: string;
  uploadedAfter?: Date;
  uploadedBefore?: Date;
  minSizeBytes?: number;
  limit?: number;
  cursor?: string;
}

export interface FileInventoryRow {
  id: string;
  tenantId: string;
  category: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
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

/* ─── category admin ──────────────────────────────────────────────────── */

/** The tunable subset a tenant admin may override. Every field optional; a set field must be *no less restrictive* than the base. */
export interface FileCategoryOverrideInput {
  allowedContentTypes?: string[];
  maxSizeBytes?: number;
  minSizeBytes?: number;
  allowedExtensions?: string[] | null;
  onUnscannable?: 'reject' | 'allow';
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

/** A tenant override tried to loosen a rule past the base (or past the app-global validator). */
export class CategoryLooseningNotAllowedError extends Error {
  constructor(field: string) {
    super(`file category override for '${field}' may only be more restrictive than the base definition`);
    this.name = 'CategoryLooseningNotAllowedError';
  }
}
