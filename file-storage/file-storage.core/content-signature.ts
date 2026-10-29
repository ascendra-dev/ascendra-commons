/**
 * Magic bytes — what a file's first bytes say it is, whatever its name and
 * declared content type claim. A browser sends the type from the extension,
 * so `invoice.pdf` that is really an HTML page or a Windows executable
 * arrives as `application/pdf`; the signature is what gives it away.
 *
 * Deliberately small: the types an upload category usually accepts, plus the
 * executable formats that are never acceptable as a document or an image.
 */

type Matcher = (b: Buffer) => boolean;

const at = (offset: number, ...bytes: number[]): Matcher => (b) =>
  b.length >= offset + bytes.length && bytes.every((v, i) => b[offset + i] === v);
const ascii = (offset: number, text: string): Matcher => at(offset, ...Buffer.from(text, 'latin1'));
const any = (...ms: Matcher[]): Matcher => (b) => ms.some((m) => m(b));

/** ISO base media (`ftyp` box at 4) with one of these brands at 8. */
const ftyp = (...brands: string[]): Matcher => (b) =>
  ascii(4, 'ftyp')(b) && brands.some((brand) => ascii(8, brand)(b));

const ZIP = any(at(0, 0x50, 0x4b, 0x03, 0x04), at(0, 0x50, 0x4b, 0x05, 0x06));
const OLE2 = at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

/** Declared content type → what its bytes must look like. A type not listed here isn't checked (CSV, JSON, plain text). */
const SIGNATURES: Record<string, Matcher> = {
  'application/pdf': ascii(0, '%PDF-'),
  'image/png': at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/jpeg': at(0, 0xff, 0xd8, 0xff),
  'image/gif': any(ascii(0, 'GIF87a'), ascii(0, 'GIF89a')),
  'image/webp': (b) => ascii(0, 'RIFF')(b) && ascii(8, 'WEBP')(b),
  'image/tiff': any(at(0, 0x49, 0x49, 0x2a, 0x00), at(0, 0x4d, 0x4d, 0x00, 0x2a)),
  'image/bmp': ascii(0, 'BM'),
  'image/heic': ftyp('heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'),
  'image/heif': ftyp('heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'),
  'image/avif': ftyp('avif', 'avis'),
  'video/mp4': ftyp('isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '),
  'application/zip': ZIP,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ZIP,
  'application/vnd.oasis.opendocument.text': ZIP,
  'application/vnd.oasis.opendocument.spreadsheet': ZIP,
  'application/msword': OLE2,
  'application/vnd.ms-excel': OLE2,
  'application/vnd.ms-powerpoint': OLE2,
};

/** Native executables — Windows PE, ELF, Mach-O (thin and fat). */
const EXECUTABLE: Matcher = any(
  ascii(0, 'MZ'),
  at(0, 0x7f, 0x45, 0x4c, 0x46),
  at(0, 0xfe, 0xed, 0xfa, 0xce),
  at(0, 0xfe, 0xed, 0xfa, 0xcf),
  at(0, 0xce, 0xfa, 0xed, 0xfe),
  at(0, 0xcf, 0xfa, 0xed, 0xfe),
  at(0, 0xca, 0xfe, 0xba, 0xbe),
);

/** Declared types an executable may legitimately carry. */
const EXECUTABLE_TYPES = new Set([
  'application/x-msdownload',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/octet-stream',
  'application/java-vm',
]);

export type ContentSignatureVerdict =
  | { ok: true }
  | { ok: false; reason: 'mismatch' | 'executable' };

/**
 * Do these bytes match the declared type? `mismatch` — the type has a known
 * signature and the bytes don't carry it; `executable` — the bytes are a
 * native executable declared as something else. A type with no known
 * signature passes (there is nothing to check it against).
 */
export function checkContentSignature(data: Buffer, declaredType: string): ContentSignatureVerdict {
  const type = declaredType.toLowerCase().split(';')[0].trim();
  if (EXECUTABLE(data) && !EXECUTABLE_TYPES.has(type)) return { ok: false, reason: 'executable' };
  const matcher = SIGNATURES[type];
  if (matcher && !matcher(data)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

/** The declared types this check knows a signature for. */
export const SIGNATURE_CHECKED_TYPES: readonly string[] = Object.keys(SIGNATURES);
