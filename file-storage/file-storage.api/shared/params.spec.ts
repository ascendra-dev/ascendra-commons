import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { bodyIntParam, cursorParam, intParam, knownKeys, stringListParam, uuidParam } from './params';
import { encodeKeysetCursor } from '../../file-storage.core';

const bad = (fn: () => unknown) => expect(fn).toThrow(BadRequestException);

describe('file-storage.api params', () => {
  it('uuidParam takes a uuid and refuses anything else', () => {
    expect(uuidParam('id', '0b9f6c2e-3c1a-4f7e-9a0b-1c2d3e4f5a6b')).toBe('0b9f6c2e-3c1a-4f7e-9a0b-1c2d3e4f5a6b');
    bad(() => uuidParam('id', 'categories'));
    bad(() => uuidParam('id', ''));
  });

  it('intParam names its range — never clamps, never NaN', () => {
    expect(intParam('limit', '20', 1, 200)).toBe(20);
    expect(intParam('limit', undefined, 1, 200)).toBeUndefined();
    bad(() => intParam('limit', 'abc', 1, 200));
    bad(() => intParam('limit', '500', 1, 200));
    bad(() => intParam('limit', '1.5', 1, 200));
  });

  it('cursorParam accepts only a cursor a list issued', () => {
    const c = encodeKeysetCursor('2026-10-29T10:00:00.123456Z', '0b9f6c2e-3c1a-4f7e-9a0b-1c2d3e4f5a6b');
    expect(cursorParam(c)).toBe(c);
    bad(() => cursorParam('garbage'));
    bad(() => cursorParam(Buffer.from('2026-10-29T10:00:00Z|x').toString('base64url')));
  });

  it('body lists and numbers keep null (inherit) and refuse wrong types', () => {
    expect(stringListParam('x', null)).toBeNull();
    expect(stringListParam('x', ['pdf'])).toEqual(['pdf']);
    bad(() => stringListParam('x', 'pdf'));
    bad(() => stringListParam('x', [1]));
    expect(bodyIntParam('n', null, 1)).toBeNull();
    bad(() => bodyIntParam('n', '5', 1));
    bad(() => bodyIntParam('n', 0, 1));
  });

  it('knownKeys refuses a typo by name', () => {
    expect(() => knownKeys('the body', { maxSize: 1 }, ['maxSizeBytes'])).toThrow(/"maxSize"/);
  });
});
