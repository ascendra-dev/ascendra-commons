import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_file_tenant_quota` table — one row per tenant with a
 * storage limit; no row, no limit. Written by `PostgresStorageQuotaStore`;
 * migration `0007_tenant_quota`.
 */
export const tenantQuotaTable = pgTable('commons_file_tenant_quota', {
  tenantId: text('tenant_id').primaryKey(),
  maxBytes: bigint('max_bytes', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull(),
});
