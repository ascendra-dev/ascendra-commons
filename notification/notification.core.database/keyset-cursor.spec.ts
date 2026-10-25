import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor, isDeliveryId } from './keyset-cursor';

describe('keyset-cursor', () => {
  it('round-trips a microsecond timestamp + id', () => {
    const ts = '2026-06-01T12:34:56.123456Z';
    expect(decodeKeysetCursor(encodeKeysetCursor(ts, '4210'))).toEqual({ timestamp: ts, id: '4210' });
  });

  it('is JSON inside — a delimiter in a part changes nothing', () => {
    expect(JSON.parse(Buffer.from(encodeKeysetCursor('2026-06-01T00:00:00Z', '1'), 'base64url').toString())).toEqual([
      '2026-06-01T00:00:00Z',
      '1',
    ]);
  });

  it('returns null for anything it never issued', () => {
    expect(decodeKeysetCursor('not-base64!')).toBeNull();
    expect(decodeKeysetCursor(Buffer.from('nope').toString('base64url'))).toBeNull();
    // the old delimited format
    expect(decodeKeysetCursor(Buffer.from('2026-06-01T00:00:00.000Z|5').toString('base64url'))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from(JSON.stringify(['yesterday', '5'])).toString('base64url'))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from(JSON.stringify(['2026-06-01T00:00:00Z', 'abc'])).toString('base64url'))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from(JSON.stringify(['2026-06-01T00:00:00Z', 5])).toString('base64url'))).toBeNull();
  });

  it('isDeliveryId — digits within bigint only', () => {
    expect(isDeliveryId('1')).toBe(true);
    expect(isDeliveryId('9223372036854775807')).toBe(true);
    expect(isDeliveryId('9223372036854775808')).toBe(false);
    expect(isDeliveryId('nd_71A2')).toBe(false);
    expect(isDeliveryId('-1')).toBe(false);
    expect(isDeliveryId('')).toBe(false);
  });
});
