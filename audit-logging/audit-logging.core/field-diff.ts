/**
 * A field-level before/after diff for one audit record — pure, stack-agnostic
 * (no DB, no framework), so it lives in `.core` alongside `keyset-cursor.ts`.
 * Powers the Record Detail screen's diff view over `AuditEvent.before`/`.after`.
 *
 * A key present on only one side is treated as `null` on the other — the jsonb
 * columns don't distinguish "field absent" from "field explicitly null" at
 * this level, and neither does this diff.
 *
 * Value comparison is a `JSON.stringify` equality check, which is
 * key-order-sensitive for nested objects — acceptable for the reference
 * implementation (Postgres jsonb round-trips key order for a single write),
 * but a consumer with a store that reorders keys should compare more
 * carefully.
 */
export interface FieldDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldDiffEntry[] {
  const b = before ?? {};
  const a = after ?? {};
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();

  const diffs: FieldDiffEntry[] = [];
  for (const field of fields) {
    const beforeValue = b[field] ?? null;
    const afterValue = a[field] ?? null;
    if (!sameValue(beforeValue, afterValue)) {
      diffs.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return diffs;
}

function sameValue(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  return JSON.stringify(x) === JSON.stringify(y);
}
