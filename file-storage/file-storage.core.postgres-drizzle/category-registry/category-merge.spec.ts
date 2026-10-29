import { describe, expect, it } from 'vitest';
import { assertOverrideTightens, mergeCategory } from './category-merge';
import { CategoryLooseningNotAllowedError, CategoryOverrideInvalidError } from '../../file-storage.core';
import { parseOverrideRow, type BaseCategoryRow } from './category-row';

const base: BaseCategoryRow = {
  key: 'kyc.identity-document',
  label: 'ID',
  bucket: 'kyc',
  allowedContentTypes: ['image/jpeg', 'application/pdf'],
  allowedExtensions: ['jpg', 'pdf'],
  maxSizeBytes: 8_000,
  minSizeBytes: 10,
  onUnscannable: 'reject',
  signedLinkExpirySeconds: 300,
  retention: 'indefinite',
  active: true,
};

describe('mergeCategory', () => {
  it('returns the base when there is no override', () => {
    expect(mergeCategory(base, null)).toMatchObject({ maxSizeBytes: 8_000, allowedContentTypes: ['image/jpeg', 'application/pdf'] });
  });
  it('override values win field by field, unset fields inherit', () => {
    const m = mergeCategory(base, { maxSizeBytes: 4_000, active: true });
    expect(m.maxSizeBytes).toBe(4_000);
    expect(m.allowedContentTypes).toEqual(['image/jpeg', 'application/pdf']);
  });
  it('is inactive when the base is inactive', () => {
    expect(mergeCategory({ ...base, active: false }, { active: true }).active).toBe(false);
  });
  it('is inactive when the tenant deactivated their override', () => {
    expect(mergeCategory(base, { active: false }).active).toBe(false);
  });
  it('an explicit null allowedExtensions inherits the base list — an override never removes it', () => {
    expect(mergeCategory(base, { allowedExtensions: null, active: true }).allowedExtensions).toEqual(['jpg', 'pdf']);
  });
  it('a stored override that only tightens the size keeps the base extension list (its column is NULL)', () => {
    const row = parseOverrideRow({ key: base.key, tenant_id: 't1', max_size_bytes: 500, allowed_extensions: null, active: true });
    expect(mergeCategory(base, row)).toMatchObject({ maxSizeBytes: 500, allowedExtensions: ['jpg', 'pdf'] });
  });
});

describe('assertOverrideTightens', () => {
  it('allows a smaller max size', () => expect(() => assertOverrideTightens(base, { maxSizeBytes: 4_000 })).not.toThrow());
  it('rejects a larger max size', () =>
    expect(() => assertOverrideTightens(base, { maxSizeBytes: 16_000 })).toThrow(CategoryLooseningNotAllowedError));
  it('rejects a smaller min size', () =>
    expect(() => assertOverrideTightens(base, { minSizeBytes: 1 })).toThrow(CategoryLooseningNotAllowedError));
  it('allows a subset of content types', () =>
    expect(() => assertOverrideTightens(base, { allowedContentTypes: ['application/pdf'] })).not.toThrow());
  it('rejects a content type not in the base set', () =>
    expect(() => assertOverrideTightens(base, { allowedContentTypes: ['image/tiff'] })).toThrow(CategoryLooseningNotAllowedError));
  it('accepts null lists — they inherit the base', () =>
    expect(() => assertOverrideTightens(base, { allowedExtensions: null, allowedContentTypes: null })).not.toThrow());
  it('rejects an extension the base does not allow', () =>
    expect(() => assertOverrideTightens(base, { allowedExtensions: ['exe'] })).toThrow(CategoryLooseningNotAllowedError));
  it('rejects a longer signed-link expiry', () =>
    expect(() => assertOverrideTightens(base, { signedLinkExpirySeconds: 3_600 })).toThrow(CategoryLooseningNotAllowedError));
  it('rejects softening onUnscannable from reject to allow', () =>
    expect(() => assertOverrideTightens(base, { onUnscannable: 'allow' })).toThrow(CategoryLooseningNotAllowedError));
  it('allows onUnscannable reject when base already rejects', () =>
    expect(() => assertOverrideTightens(base, { onUnscannable: 'reject' })).not.toThrow());
  it('when the base accepts any content type, any override list is a tightening', () =>
    expect(() => assertOverrideTightens({ ...base, allowedContentTypes: [] }, { allowedContentTypes: ['x/y'] })).not.toThrow());
});

describe('assertOverrideTightens — values that cannot be a rule', () => {
  it.each([
    [{ maxSizeBytes: 0 }, 'maxSizeBytes'],
    [{ maxSizeBytes: 1.5 }, 'maxSizeBytes'],
    [{ minSizeBytes: -1 }, 'minSizeBytes'],
    [{ signedLinkExpirySeconds: 0 }, 'signedLinkExpirySeconds'],
    [{ allowedContentTypes: [] }, 'allowedContentTypes'],
    [{ allowedExtensions: [] }, 'allowedExtensions'],
  ])('%j is invalid', (input, field) => {
    expect(() => assertOverrideTightens(base, input)).toThrow(CategoryOverrideInvalidError);
    expect(() => assertOverrideTightens(base, input)).toThrow(field);
  });
  it('rejects a minimum above the maximum (the override max against the base min, too)', () => {
    expect(() => assertOverrideTightens(base, { minSizeBytes: 5_000, maxSizeBytes: 4_000 })).toThrow(CategoryOverrideInvalidError);
    expect(() => assertOverrideTightens(base, { maxSizeBytes: 5 })).toThrow(CategoryOverrideInvalidError);
  });
});
