import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor';

describe('keyset cursor', () => {
  it('round-trips a microsecond timestamp exactly', () => {
    const cursor = encodeKeysetCursor('2026-10-22T10:00:00.123456Z', 'key-1', 'tenant_acme');
    expect(decodeKeysetCursor(cursor)).toEqual({ timestamp: '2026-10-22T10:00:00.123456Z', key: 'key-1', scope: 'tenant_acme' });
  });

  it('round-trips a key or scope holding the old delimiter', () => {
    const cursor = encodeKeysetCursor('2026-10-22T10:00:00.000001Z', 'order|42|retry', 'a|b');
    expect(decodeKeysetCursor(cursor)).toMatchObject({ key: 'order|42|retry', scope: 'a|b' });
  });

  it.each([
    ['garbage', 'garbage'],
    ['not JSON', Buffer.from('2026-10-22T10:00:00Z|k|s').toString('base64url')],
    ['too short', Buffer.from(JSON.stringify(['2026-10-22T10:00:00Z', 'k'])).toString('base64url')],
    ['a non-string part', Buffer.from(JSON.stringify(['2026-10-22T10:00:00Z', 1, 's'])).toString('base64url')],
    ['an empty part', Buffer.from(JSON.stringify(['2026-10-22T10:00:00Z', '', 's'])).toString('base64url')],
    ['a bad timestamp', Buffer.from(JSON.stringify(['yesterday', 'k', 's'])).toString('base64url')],
  ])('rejects %s', (_label, cursor) => {
    expect(decodeKeysetCursor(cursor)).toBeNull();
  });
});
