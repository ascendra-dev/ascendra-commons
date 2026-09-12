import type {
  FileCategory,
  FileCategoryOverrideInput,
  Retention,
} from '../../file-storage.core';

/** A parsed `commons_file_category` row with `tenant_id IS NULL` — a base definition. */
export type BaseCategoryRow = FileCategory & { active: boolean };

/** A parsed `commons_file_category` row with a non-NULL `tenant_id` — a tenant override. */
export type OverrideCategoryRow = FileCategoryOverrideInput & { active: boolean };

function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? (v as string[]) : undefined;
}
function asNumber(v: unknown): number | undefined {
  return v === null || v === undefined ? undefined : Number(v);
}

export function parseBaseRow(r: Record<string, unknown>): BaseCategoryRow {
  return {
    key: r.key as string,
    label: (r.label as string | null) ?? (r.key as string),
    description: (r.description as string | null) ?? undefined,
    bucket: (r.bucket as string | null) ?? 'attachments',
    allowedContentTypes: asStringArray(r.allowed_content_types) ?? [],
    maxSizeBytes: asNumber(r.max_size_bytes) ?? Number.MAX_SAFE_INTEGER,
    minSizeBytes: asNumber(r.min_size_bytes) ?? 1,
    allowedExtensions: asStringArray(r.allowed_extensions),
    onUnscannable: (r.on_unscannable as 'reject' | 'allow' | null) ?? 'reject',
    signedLinkExpirySeconds: asNumber(r.signed_link_expiry_seconds),
    retention: (r.retention as Retention | null) ?? 'indefinite',
    active: r.active !== false,
  };
}

export function parseOverrideRow(r: Record<string, unknown>): OverrideCategoryRow {
  return {
    allowedContentTypes: asStringArray(r.allowed_content_types),
    maxSizeBytes: asNumber(r.max_size_bytes),
    minSizeBytes: asNumber(r.min_size_bytes),
    allowedExtensions: r.allowed_extensions === null ? null : asStringArray(r.allowed_extensions),
    onUnscannable: (r.on_unscannable as 'reject' | 'allow' | null) ?? undefined,
    signedLinkExpirySeconds: asNumber(r.signed_link_expiry_seconds),
    active: r.active !== false,
  };
}
