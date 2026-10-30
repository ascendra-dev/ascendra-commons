/**
 * Request shapes for `file-storage.api`, as the controllers hand them to the
 * services — already parsed and validated (`shared/params.ts`): a bad value is
 * a 400 before it gets here. Plain interfaces — `ascendra-commons` carries no
 * validation library.
 */

export const FILE_REJECTION_REASONS = ['category-unavailable', 'validation-failed', 'quota-exceeded', 'scan-rejected'] as const;
export type FileRejectionReasonParam = (typeof FILE_REJECTION_REASONS)[number];

export interface FileInventoryQueryDto {
  tenantId?: string;
  category?: string;
  uploadedBy?: string;
  uploadedAfter?: Date;
  uploadedBefore?: Date;
  minSizeBytes?: number;
  held?: boolean;
  search?: string;
  scanVerdict?: 'clean' | 'unscannable';
  limit?: number;
  cursor?: string;
}

export interface StorageUsageQueryDto {
  tenantId?: string;
}

export interface OrphanQueryDto {
  tenantId?: string;
  olderThan?: Date;
  limit?: number;
  cursor?: string;
}

export interface AccessLogQueryDto {
  limit?: number;
  cursor?: string;
}

export interface FileStatsQueryDto {
  tenantId?: string;
  windowDays?: number;
  /** IANA zone the days are counted in. */
  timeZone?: string;
}

export interface FileRejectionQueryDto {
  tenantId?: string;
  category?: string;
  reason?: FileRejectionReasonParam;
  occurredAfter?: Date;
  occurredBefore?: Date;
  limit?: number;
  cursor?: string;
}

/**
 * PATCH body for a category. Every field optional; a set field must be no
 * less restrictive than the base; `null` clears that field's override.
 * A platform admin naming no `tenantId` edits the base row — only `active`.
 */
export interface UpsertCategoryOverrideBody {
  /** Platform admin only — which tenant's override to write. A tenant admin's own tenant is used; naming another is a 403. */
  tenantId?: string;
  allowedContentTypes?: string[] | null;
  maxSizeBytes?: number | null;
  minSizeBytes?: number | null;
  allowedExtensions?: string[] | null;
  onUnscannable?: 'reject' | 'allow' | null;
  signedLinkExpirySeconds?: number | null;
  active?: boolean;
}

export const UPSERT_CATEGORY_OVERRIDE_FIELDS = [
  'tenantId',
  'allowedContentTypes',
  'maxSizeBytes',
  'minSizeBytes',
  'allowedExtensions',
  'onUnscannable',
  'signedLinkExpirySeconds',
  'active',
] as const;

export interface PlaceLegalHoldBody {
  reason: string;
}
