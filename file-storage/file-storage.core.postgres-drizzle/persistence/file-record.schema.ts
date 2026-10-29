import { sql } from 'drizzle-orm';
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
    tenantId: text('tenant_id').notNull(),
    /** Opaque reference into `FileStore` — `"{bucket}/{objectKey}"`. */
    fileRef: text('file_ref').notNull(),
    /** A `FileCategory` key. */
    category: text('category').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the bytes, hex. Passive — forensics / future dedupe. */
    contentHash: text('content_hash'),
    uploadedBy: text('uploaded_by').notNull(),
    /** The uploader's name for the file, cleaned (no path, no control characters). NULL before migration 0006. */
    filename: text('filename'),
    /** `'clean'` | `'unscannable'` — an infected file is never stored. NULL before migration 0006. */
    scanVerdict: text('scan_verdict').$type<'clean' | 'unscannable'>(),
    /** Fixed at upload from the category's `keepForDays`: no delete before, the retention run deletes after. NULL = indefinite. */
    retainUntil: timestamp('retain_until', { withTimezone: true, mode: 'date' }),
    /** Legal hold — set: nobody deletes the file and retention skips it. */
    heldAt: timestamp('held_at', { withTimezone: true, mode: 'date' }),
    heldBy: text('held_by'),
    holdReason: text('hold_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('commons_file_record_tenant_category_idx').on(t.tenantId, t.category, t.createdAt),
    index('commons_file_record_content_hash_idx').on(t.contentHash),
    index('commons_file_record_tenant_created_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    index('commons_file_record_uploaded_by_idx').on(t.uploadedBy, t.createdAt.desc()),
    index('commons_file_record_retain_until_idx').on(t.retainUntil).where(sql`${t.retainUntil} IS NOT NULL`),
    index('commons_file_record_file_ref_idx').on(t.fileRef),
    index('commons_file_record_held_idx').on(t.heldAt.desc()).where(sql`${t.heldAt} IS NOT NULL`),
    index('commons_file_record_created_id_idx').on(t.createdAt.desc(), t.id.desc()),
    // 0007: INCLUDE (size_bytes) — drizzle's index builder has no INCLUDE; the migration is the source of truth.
    index('commons_file_record_tenant_size_idx').on(t.tenantId),
  ],
);
