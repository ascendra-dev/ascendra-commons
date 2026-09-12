import { sql, type SQL } from 'drizzle-orm';

/**
 * A parameterised `text[]` literal — `ARRAY[$1, $2, ...]::text[]`. Drizzle's
 * `sql` template spreads a bare JS array into a row constructor `($1, $2)`,
 * which is not an array, so array columns go through this instead. An empty
 * array renders `ARRAY[]::text[]`.
 */
export function textArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/** `$1::jsonb` for a value serialised with `JSON.stringify`. */
export function jsonbParam(value: unknown): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}
