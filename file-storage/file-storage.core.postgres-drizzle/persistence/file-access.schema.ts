import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { fileRecordTable } from './file-record.schema';

/**
 * The reference `commons_file_access` table — one row per download URL handed
 * out. Written best-effort by `PostgresFileAccessRecorder`; read by
 * `PostgresFileStorageObservabilityService.getAccessLog`.
 *
 * Reads only. Uploads and deletes are carried by the optional
 * `FileStorageAuditEmitter` as domain audit events, not here.
 */
export const fileAccessTable = pgTable(
  'commons_file_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileRecordId: uuid('file_record_id')
      .notNull()
      .references(() => fileRecordTable.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    /** NULL for a signed-link fetch — no authenticated actor. */
    actorId: text('actor_id'),
    via: text('via').$type<'actor' | 'signed-link'>().notNull(),
    purpose: text('purpose').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => ({
    byFile: index('commons_file_access_file_idx').on(t.fileRecordId, t.occurredAt),
    byOccurredAt: index('commons_file_access_occurred_at_idx').on(t.occurredAt),
  }),
);
