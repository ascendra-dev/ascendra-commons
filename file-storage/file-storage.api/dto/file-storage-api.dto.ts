/**
 * Request shapes for `file-storage.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. Controllers parse query strings; the `.api`
 * services apply the actor-scoped rules.
 */

export interface FileInventoryQueryDto {
  tenantId?: string;
  category?: string;
  uploadedBy?: string;
  uploadedAfter?: string;
  uploadedBefore?: string;
  minSizeBytes?: number;
  limit?: number;
  cursor?: string;
}

export interface StorageUsageQueryDto {
  tenantId?: string;
}

export interface OrphanQueryDto {
  tenantId?: string;
  olderThan?: string;
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
}

export interface FileRejectionQueryDto {
  tenantId?: string;
  category?: string;
  reason?: 'category-unavailable' | 'validation-failed' | 'scan-rejected';
  limit?: number;
  cursor?: string;
}

/** PATCH body for a tenant's category override. Every field optional; a set field must be no less restrictive than the base. */
export interface UpsertCategoryOverrideBody {
  /** Platform admin only — which tenant's override to write. A tenant admin's own tenant is used and this is ignored. */
  tenantId?: string;
  allowedContentTypes?: string[];
  maxSizeBytes?: number;
  minSizeBytes?: number;
  allowedExtensions?: string[] | null;
  onUnscannable?: 'reject' | 'allow';
  signedLinkExpirySeconds?: number | null;
  active?: boolean;
}
