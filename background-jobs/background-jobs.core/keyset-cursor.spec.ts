import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor, isRunId } from './keyset-cursor';

describe('keyset-cursor', () => {
  it('round-trips a microsecond timestamp + id', () => {
    const ts = '2026-06-01T12:34:56.123456Z';
    expect(decodeKeysetCursor(encodeKeysetCursor(ts, '4210'))).toEqual({ timestamp: ts, id: '4210' });
  });

  it('returns null for a malformed cursor', () => {
    const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
    expect(decodeKeysetCursor('!!!')).toBeNull();
    expect(decodeKeysetCursor(b64('nope'))).toBeNull();
    expect(decodeKeysetCursor(b64('2026-06-01T00:00:00Z|5'))).toBeNull();
    expect(decodeKeysetCursor(b64(['not-a-date', '5']))).toBeNull();
    expect(decodeKeysetCursor(b64(['2026-06-01T00:00:00Z', 'abc']))).toBeNull();
    expect(decodeKeysetCursor(b64(['2026-06-01T00:00:00Z', '5', 'extra']))).toBeNull();
    expect(decodeKeysetCursor(b64(['2026-06-01T00:00:00Z', '99999999999999999999']))).toBeNull();
  });

  it('isRunId accepts bigint text only', () => {
    expect(isRunId('42')).toBe(true);
    expect(isRunId('9223372036854775807')).toBe(true);
    expect(isRunId('9223372036854775808')).toBe(false);
    expect(isRunId('abc')).toBe(false);
    expect(isRunId('-1')).toBe(false);
    expect(isRunId('')).toBe(false);
  });
});
