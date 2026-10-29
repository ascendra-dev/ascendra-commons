import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_file_access` table — one row per download URL handed
 * out. Written best-effort by `PostgresFileAccessRecorder`; read by
 * `PostgresFileStorageObservabilityService.getAccessLog`.
 *
 * Reads only. Uploads and deletes are carried by the optional
 * `FileStorageAuditEmitter` as domain audit events, not here.
 *
 * No foreign key (dropped in migration 0006): deleting a file keeps its access
 * log — "who downloaded this" must outlive the file.
 */
export const fileAccessTable = pgTable(
  'commons_file_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileRecordId: uuid('file_record_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** NULL for a signed-link fetch — no authenticated actor. */
    actorId: text('actor_id'),
    via: text('via').$type<'actor' | 'signed-link'>().notNull(),
    purpose: text('purpose').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('commons_file_access_file_idx').on(t.fileRecordId, t.occurredAt),
    index('commons_file_access_occurred_at_idx').on(t.occurredAt),
  ],
);
