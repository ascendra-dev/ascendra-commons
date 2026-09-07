import { bigint, boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Retention } from '../../file-storage.core';

/**
 * The reference `commons_file_category` table — the two-layer catalog.
 *
 *   - `tenant_id IS NULL`  → a **base** definition. Developer-controlled,
 *     seeded at deploy time (`source = 'seed'`). `label`/`description`/`bucket`/
 *     `retention` are set only on these rows.
 *   - `tenant_id = <id>`   → a per-tenant **override** (`source = 'tenant'`).
 *     Only the tunable columns; unset columns inherit from the base row.
 *
 * `PostgresFileCategoryRegistry.resolve` reads at most a base row + one
 * override and merges them. Requires PostgreSQL 15+ for partial unique indexes
 * (used here so NULL `tenant_id` is unique per key while non-NULL is unique per
 * `(key, tenant_id)`).
 */
export const fileCategoryTable = pgTable(
  'commons_file_category',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    /** NULL = base definition. */
    tenantId: uuid('tenant_id'),

    /* base-only */
    label: text('label'),
    description: text('description'),
    bucket: text('bucket'),
    retention: jsonb('retention').$type<Retention>(),

    /* base default + tenant override */
    allowedContentTypes: text('allowed_content_types').array(),
    maxSizeBytes: bigint('max_size_bytes', { mode: 'number' }),
    minSizeBytes: bigint('min_size_bytes', { mode: 'number' }),
    allowedExtensions: text('allowed_extensions').array(),
    onUnscannable: text('on_unscannable').$type<'reject' | 'allow'>(),
    signedLinkExpirySeconds: integer('signed_link_expiry_seconds'),

    active: boolean('active').notNull().default(true),
    source: text('source').$type<'seed' | 'platform' | 'tenant'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    uqBase: uniqueIndex('commons_file_category_base_uq')
      .on(t.key)
      .where(sql`${t.tenantId} IS NULL`),
    uqTenant: uniqueIndex('commons_file_category_tenant_uq')
      .on(t.key, t.tenantId)
      .where(sql`${t.tenantId} IS NOT NULL`),
  }),
);
