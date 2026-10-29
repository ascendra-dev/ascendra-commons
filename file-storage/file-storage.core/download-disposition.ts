/**
 * How a download URL serves a file — shared by every `FileStore` that sets
 * response headers per URL (local-disk, S3), so they serve the same file the
 * same way.
 */

/**
 * Types a browser may show in its own tab. Anything else downloads — an HTML
 * or SVG upload never runs as a page on the storage origin.
 */
export const INLINE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
]);

/** RFC 6266 `Content-Disposition` with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string | null | undefined): string {
  if (!filename) return kind;
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** The `Content-Type` and `Content-Disposition` to serve a file with: inline for the safe few, an octet-stream attachment otherwise. */
export function downloadHeaders(contentType: string | undefined, filename: string | null | undefined): { type: string; disposition: string } {
  const type = contentType?.toLowerCase().split(';')[0].trim() ?? '';
  const inline = INLINE_CONTENT_TYPES.has(type);
  return {
    type: inline ? type : 'application/octet-stream',
    disposition: contentDisposition(inline ? 'inline' : 'attachment', filename),
  };
}
