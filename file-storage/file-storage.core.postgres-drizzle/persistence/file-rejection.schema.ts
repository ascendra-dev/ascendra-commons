import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { FileUploadRejectionReason } from '../../file-storage.core';

/**
 * The reference `commons_file_rejection` table — one row per upload attempt
 * `AttachmentService.attach` refused (bad/unavailable category, a validation
 * rule violation, or a failed/unscannable-and-rejected malware scan). Written
 * best-effort by `PostgresFileUploadRejectionRecorder`; read by
 * `PostgresFileStorageObservabilityService.listRejections`.
 *
 * No blob is ever written for a rejection — metadata only.
 */
export const fileRejectionTable = pgTable(
  'commons_file_rejection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    actorId: text('actor_id').notNull(),
    /** The requested `FileCategory` key — may not resolve to a real/active category. */
    category: text('category').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    reason: text('reason').$type<FileUploadRejectionReason>().notNull(),
    message: text('message').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('commons_file_rejection_tenant_idx').on(t.tenantId, t.occurredAt),
    index('commons_file_rejection_occurred_at_idx').on(t.occurredAt),
  ],
);
