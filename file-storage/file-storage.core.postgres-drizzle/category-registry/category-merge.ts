import {
  CategoryLooseningNotAllowedError,
  CategoryOverrideInvalidError,
  type ResolvedFileCategory,
} from '../../file-storage.core';
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
    // `null` and absent both inherit — an override narrows a list, it never removes one.
    allowedExtensions: override?.allowedExtensions ?? base.allowedExtensions,
    onUnscannable: override?.onUnscannable ?? base.onUnscannable,
    signedLinkExpirySeconds: override?.signedLinkExpirySeconds ?? base.signedLinkExpirySeconds,
    active: base.active && (override ? override.active : true),
  };
}

/**
 * A tenant override may only make a rule *more* restrictive than the base
 * (decision 8f). Throws `CategoryOverrideInvalidError` for a value that can't
 * be a rule at all (a size of 0, an empty list, a minimum above the maximum),
 * then `CategoryLooseningNotAllowedError` on the first field that would widen
 * the base. A `null` list or expiry means "inherit the base" — always allowed.
 */
export function assertOverrideTightens(
  base: BaseCategoryRow,
  input: Partial<OverrideCategoryRow>,
): void {
  assertOverrideSane(base, input);
  if (input.maxSizeBytes != null && input.maxSizeBytes > base.maxSizeBytes) {
    throw new CategoryLooseningNotAllowedError('maxSizeBytes');
  }
  if (input.minSizeBytes != null && input.minSizeBytes < (base.minSizeBytes ?? 1)) {
    throw new CategoryLooseningNotAllowedError('minSizeBytes');
  }
  if (input.allowedContentTypes && base.allowedContentTypes.length > 0) {
    const allowed = new Set(base.allowedContentTypes.map((t) => t.toLowerCase()));
    if (input.allowedContentTypes.some((t) => !allowed.has(t.toLowerCase()))) {
      throw new CategoryLooseningNotAllowedError('allowedContentTypes');
    }
  }
  if (input.allowedExtensions && base.allowedExtensions && base.allowedExtensions.length > 0) {
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

function isWhole(n: unknown, min: number): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= min;
}

/** Values that can't be a rule whatever the base says. */
function assertOverrideSane(base: BaseCategoryRow, input: Partial<OverrideCategoryRow>): void {
  if (input.maxSizeBytes != null && !isWhole(input.maxSizeBytes, 1)) {
    throw new CategoryOverrideInvalidError('maxSizeBytes', 'must be a whole number of bytes, at least 1');
  }
  if (input.minSizeBytes != null && !isWhole(input.minSizeBytes, 1)) {
    throw new CategoryOverrideInvalidError('minSizeBytes', 'must be a whole number of bytes, at least 1');
  }
  if (input.signedLinkExpirySeconds != null && !isWhole(input.signedLinkExpirySeconds, 1)) {
    throw new CategoryOverrideInvalidError('signedLinkExpirySeconds', 'must be a whole number of seconds, at least 1');
  }
  if (input.allowedContentTypes && input.allowedContentTypes.length === 0) {
    throw new CategoryOverrideInvalidError('allowedContentTypes', 'must not be empty — send null to inherit the base list');
  }
  if (input.allowedExtensions && input.allowedExtensions.length === 0) {
    throw new CategoryOverrideInvalidError('allowedExtensions', 'must not be empty — send null to inherit the base list');
  }
  const min = input.minSizeBytes ?? base.minSizeBytes ?? 1;
  const max = input.maxSizeBytes ?? base.maxSizeBytes;
  if (min > max) {
    throw new CategoryOverrideInvalidError('minSizeBytes', `${min} is above the maximum of ${max} — no file could be uploaded`);
  }
}
