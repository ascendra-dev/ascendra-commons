import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { fileRecordTable } from './file-record.schema';

/**
 * The reference `commons_attachment` table — the polymorphic association from a
 * `FileRecord` to a business entity. `PostgresAttachmentStore` writes exactly
 * these columns; change this and the store's SQL together, and ship the change
 * as the next numbered file in `../migrations/` (never an edit to a released one).
 *
 * `ON DELETE CASCADE` on `file_record_id` means `deleteFileCascade` can delete
 * the `commons_file_record` row and Postgres removes the associations — but the
 * store still deletes both in one explicit transaction so a stack without the
 * FK still behaves.
 */
export const attachmentTable = pgTable(
  'commons_attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileRecordId: uuid('file_record_id')
      .notNull()
      .references(() => fileRecordTable.id, { onDelete: 'cascade' }),
    attachedToType: text('attached_to_type').notNull(),
    attachedToId: text('attached_to_id').notNull(),
    category: text('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('commons_attachment_entity_idx').on(t.attachedToType, t.attachedToId),
    index('commons_attachment_file_record_idx').on(t.fileRecordId),
  ],
);
