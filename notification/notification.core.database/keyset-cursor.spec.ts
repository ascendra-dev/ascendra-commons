import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor';

describe('keyset-cursor', () => {
  it('round-trips a timestamp + id', () => {
    const ts = new Date('2026-06-01T12:34:56.000Z');
    const decoded = decodeKeysetCursor(encodeKeysetCursor(ts, '4210'));
    expect(decoded).toEqual({ timestamp: ts, id: '4210' });
  });

  it('returns null for a malformed cursor', () => {
    expect(decodeKeysetCursor('not-base64!')).toBeNull();
    expect(decodeKeysetCursor(Buffer.from('nope').toString('base64url'))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from('not-a-date|5').toString('base64url'))).toBeNull();
  });
});
