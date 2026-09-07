import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_file_record` table — source of truth for the columns.
 * `PostgresAttachmentStore` writes exactly these; keep this,
 * `file-record.migration.sql`, and the store's SQL in sync.
 *
 * A consuming project on Postgres/Drizzle re-exports this from its own schema
 * barrel for `drizzle-kit`, or copies the migration. A project on another
 * stack ignores this folder and provides its own `AttachmentStore`.
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
  (t) => ({
    byTenantCategory: index('commons_file_record_tenant_category_idx').on(t.tenantId, t.category, t.createdAt),
    byCreatedAt: index('commons_file_record_created_at_idx').on(t.createdAt),
    byContentHash: index('commons_file_record_content_hash_idx').on(t.contentHash),
  }),
);
