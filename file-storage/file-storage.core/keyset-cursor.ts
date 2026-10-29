/**
 * Opaque keyset-pagination cursor for the file inventory, orphan list, access
 * log and rejection log: base64url of the JSON `[timestamp, id]` — JSON, not a
 * delimited string, so no part can smuggle the delimiter. The timestamp is the
 * row's own column (`created_at` / `occurred_at`) at its own precision —
 * microseconds; a JS `Date` keeps milliseconds, and page 2 would skip the rows
 * that share the last row's millisecond. The id is the row's uuid tie-break.
 * Stack-agnostic — any future adapter reuses it.
 */

/** A cursor this reader never issued — the `.api` answers 400 rather than silently restarting at page one. */
export class InvalidFileCursorError extends Error {
  override readonly name = 'InvalidFileCursorError';
  constructor(cursor: string) {
    super(`"cursor" is not one this list issued: ${cursor.slice(0, 64)}`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function encodeKeysetCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify([timestamp, id])).toString('base64url');
}

/** Null unless it decodes to a UTC ISO date-time (up to microseconds) and a uuid. */
export function decodeKeysetCursor(cursor: string): { timestamp: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [timestamp, id] = parsed as unknown[];
    if (typeof timestamp !== 'string' || typeof id !== 'string') return null;
    if (!ISO_UTC.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;
    if (!UUID.test(id)) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

/** Decodes or throws `InvalidFileCursorError` — for an adapter that has been handed a cursor. */
export function requireKeysetCursor(cursor: string): { timestamp: string; id: string } {
  const decoded = decodeKeysetCursor(cursor);
  if (!decoded) throw new InvalidFileCursorError(cursor);
  return decoded;
}

/** A uuid — what a file, attachment or access-log id is. Anything else can't name one (and `::uuid` would 500). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
