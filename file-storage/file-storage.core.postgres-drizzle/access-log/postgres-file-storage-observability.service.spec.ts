import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresFileStorageObservabilityService } from './postgres-file-storage-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const lastQuery = (execute: ReturnType<typeof vi.fn>) =>
  dialect.sqlToQuery(execute.mock.calls[execute.mock.calls.length - 1][0] as SQL);

describe('PostgresFileStorageObservabilityService', () => {
  it('listFiles applies filters, keysets on (created_at, id) and over-fetches by one', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.listFiles({ tenantId: 't1', category: 'kyc', limit: 20 });

    const q = lastQuery(execute);
    expect(q.sql).toMatch(/f\.tenant_id = /);
    expect(q.sql).toMatch(/f\.category = /);
    expect(q.sql).toMatch(/order by f\.created_at desc, f\.id desc/);
    expect(q.sql).toMatch(/limit \$\d+/);
    expect(q.params).toContain(21);
  });

  it('listFiles returns a nextCursor only when the extra row is present', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `f${i}`, tenant_id: 't1', category: 'kyc', content_type: 'application/pdf',
      size_bytes: 1, uploaded_by: 'u', created_at: '2026-09-07T00:00:00Z', attachment_count: 0,
    }));
    const execute = vi.fn().mockResolvedValue({ rows });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    const page = await svc.listFiles({ limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('listOrphanedFileRecords filters to attachment-less records', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.listOrphanedFileRecords({});
    expect(lastQuery(execute).sql).toMatch(/left join commons_attachment a on a\.file_record_id = f\.id\s+where a\.id is null/i);
  });

  it('storageUsage groups by tenant and category', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.storageUsage({});
    expect(lastQuery(execute).sql).toMatch(/group by tenant_id, category/i);
  });
});
