import { CategoryLooseningNotAllowedError, type ResolvedFileCategory } from '../../file-storage.core';
import type { BaseCategoryRow, OverrideCategoryRow } from './category-row';

/** Base merged with an optional tenant override → the rules `attach` enforces for that tenant. */
export function mergeCategory(base: BaseCategoryRow, override: OverrideCategoryRow | null): ResolvedFileCategory {
  return {
    key: base.key,
    label: base.label,
    description: base.description,
    bucket: base.bucket,
    retention: base.retention,
    allowedContentTypes: override?.allowedContentTypes ?? base.allowedContentTypes,
    maxSizeBytes: override?.maxSizeBytes ?? base.maxSizeBytes,
    minSizeBytes: override?.minSizeBytes ?? base.minSizeBytes ?? 1,
    allowedExtensions:
      override && 'allowedExtensions' in override && override.allowedExtensions !== undefined
        ? override.allowedExtensions ?? undefined
        : base.allowedExtensions,
    onUnscannable: override?.onUnscannable ?? base.onUnscannable,
    signedLinkExpirySeconds: override?.signedLinkExpirySeconds ?? base.signedLinkExpirySeconds,
    active: base.active && (override ? override.active : true),
  };
}

/**
 * A tenant override may only make a rule *more* restrictive than the base
 * (decision 8f). Throws `CategoryLooseningNotAllowedError` on the first field
 * that would widen it.
 */
export function assertOverrideTightens(
  base: BaseCategoryRow,
  input: Partial<OverrideCategoryRow>,
): void {
  if (input.maxSizeBytes !== undefined && input.maxSizeBytes > base.maxSizeBytes) {
    throw new CategoryLooseningNotAllowedError('maxSizeBytes');
  }
  if (input.minSizeBytes !== undefined && input.minSizeBytes < (base.minSizeBytes ?? 1)) {
    throw new CategoryLooseningNotAllowedError('minSizeBytes');
  }
  if (input.allowedContentTypes !== undefined && base.allowedContentTypes.length > 0) {
    const allowed = new Set(base.allowedContentTypes.map((t) => t.toLowerCase()));
    if (input.allowedContentTypes.some((t) => !allowed.has(t.toLowerCase()))) {
      throw new CategoryLooseningNotAllowedError('allowedContentTypes');
    }
  }
  if (input.allowedExtensions !== undefined && base.allowedExtensions && base.allowedExtensions.length > 0) {
    if (input.allowedExtensions === null) {
      throw new CategoryLooseningNotAllowedError('allowedExtensions');
    }
    const allowed = new Set(base.allowedExtensions.map((e) => e.replace(/^\./, '').toLowerCase()));
    if (input.allowedExtensions.some((e) => !allowed.has(e.replace(/^\./, '').toLowerCase()))) {
      throw new CategoryLooseningNotAllowedError('allowedExtensions');
    }
  }
  if (
    input.signedLinkExpirySeconds != null &&
    base.signedLinkExpirySeconds !== undefined &&
    input.signedLinkExpirySeconds > base.signedLinkExpirySeconds
  ) {
    throw new CategoryLooseningNotAllowedError('signedLinkExpirySeconds');
  }
  if (input.onUnscannable === 'allow' && base.onUnscannable === 'reject') {
    throw new CategoryLooseningNotAllowedError('onUnscannable');
  }
}
