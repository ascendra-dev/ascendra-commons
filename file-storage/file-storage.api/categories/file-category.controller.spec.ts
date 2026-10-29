import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseOverrideBody } from './file-category.controller';

describe('parseOverrideBody', () => {
  it('passes typed fields through, keeping null (inherit)', () => {
    expect(parseOverrideBody({ maxSizeBytes: 1000, allowedExtensions: null, onUnscannable: null, active: false })).toEqual({
      maxSizeBytes: 1000,
      allowedExtensions: null,
      onUnscannable: null,
      active: false,
    });
  });

  it.each([
    [{ maxSizeBytes: '1000' }],
    [{ maxSize: 1 }],
    [{ onUnscannable: 'maybe' }],
    [{ active: 'yes' }],
    [{ allowedContentTypes: 'application/pdf' }],
    [[1, 2]],
  ])('%j is a 400', (body) => {
    expect(() => parseOverrideBody(body)).toThrow(BadRequestException);
  });

  it('an absent body is an empty patch', () => {
    expect(parseOverrideBody(undefined)).toEqual({});
  });
});
