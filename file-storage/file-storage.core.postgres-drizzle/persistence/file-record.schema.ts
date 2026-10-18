import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_file_record` table — source of truth for the columns.
 * `PostgresAttachmentStore` writes exactly these; change this and the store's
 * SQL together, and ship the change as the next numbered file in
 * `../migrations/` (never an edit to a released one).
 *
 * A consuming project imports this table where it queries it, but never
 * re-exports it into the schema files `drizzle-kit` reads — the table comes from
 * `../migrations/`, and drizzle-kit would generate it a second time. A project
 * on another stack ignores this folder and provides its own `AttachmentStore`.
 */
export const fileRecordTable = pgTable(
  'commons_file_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    /** Opaque reference into `FileStore` — `"{bucket}/{objectKey}"`. */
    fileRef: text('file_ref').notNull(),
    /** A `FileCategory` key. */
    category: text('category').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the bytes, hex. Passive — forensics / future dedupe. */
    contentHash: text('content_hash'),
    uploadedBy: text('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('commons_file_record_tenant_category_idx').on(t.tenantId, t.category, t.createdAt),
    index('commons_file_record_created_at_idx').on(t.createdAt),
    index('commons_file_record_content_hash_idx').on(t.contentHash),
  ],
);
