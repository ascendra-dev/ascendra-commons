import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_file_pending_upload` table — a direct upload between
 * `beginUpload` and `completeUpload`. Written by `PostgresPendingUploadStore`;
 * migration `0008_pending_upload`.
 */
export const pendingUploadTable = pgTable(
  'commons_file_pending_upload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    actorId: text('actor_id').notNull(),
    category: text('category').notNull(),
    attachedToType: text('attached_to_type').notNull(),
    attachedToId: text('attached_to_id').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    fileRef: text('file_ref').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('commons_file_pending_upload_expires_idx').on(t.expiresAt)],
);
