import { describe, expect, it } from 'vitest';
import { checkContentSignature } from './content-signature';

const b = (...bytes: number[]) => Buffer.from(bytes);
const s = (text: string) => Buffer.from(text, 'latin1');

describe('checkContentSignature', () => {
  it.each([
    ['application/pdf', s('%PDF-1.7\n')],
    ['image/png', b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)],
    ['image/jpeg', b(0xff, 0xd8, 0xff, 0xe0)],
    ['image/gif', s('GIF89a')],
    ['image/webp', s('RIFF\0\0\0\0WEBPVP8 ')],
    ['image/heic', s('\0\0\0\x18ftypheic')],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', b(0x50, 0x4b, 0x03, 0x04)],
    ['APPLICATION/PDF; charset=binary', s('%PDF-1.4')],
  ])('%s with its own signature passes', (type, data) => {
    expect(checkContentSignature(data, type)).toEqual({ ok: true });
  });

  it('a "PDF" that is really HTML is a mismatch', () => {
    expect(checkContentSignature(s('<!doctype html><script>'), 'application/pdf')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('a "PNG" that is really a JPEG is a mismatch', () => {
    expect(checkContentSignature(b(0xff, 0xd8, 0xff), 'image/png')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it.each([
    ['Windows PE', s('MZ\x90\0')],
    ['ELF', b(0x7f, 0x45, 0x4c, 0x46)],
    ['Mach-O', b(0xcf, 0xfa, 0xed, 0xfe)],
  ])('a %s executable declared as a document is refused as executable', (_, data) => {
    expect(checkContentSignature(data, 'text/csv')).toEqual({ ok: false, reason: 'executable' });
    expect(checkContentSignature(data, 'application/x-msdownload')).toEqual({ ok: true });
  });

  it('a type with no known signature passes — there is nothing to check it against', () => {
    expect(checkContentSignature(s('a,b\n1,2'), 'text/csv')).toEqual({ ok: true });
    expect(checkContentSignature(Buffer.alloc(0), 'application/json')).toEqual({ ok: true });
  });

  it('an empty "PDF" is a mismatch', () => {
    expect(checkContentSignature(Buffer.alloc(0), 'application/pdf')).toEqual({ ok: false, reason: 'mismatch' });
  });
});
