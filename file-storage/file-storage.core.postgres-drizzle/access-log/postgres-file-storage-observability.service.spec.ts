import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresFileStorageObservabilityService } from './postgres-file-storage-observability.service';
import type { SqlExecutor } from '../persistence/sql-executor';
import { decodeKeysetCursor, encodeKeysetCursor, InvalidFileCursorError } from '../../file-storage.core';

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

  it('statsSummary runs an uploads-by-day query and a by-category query, both windowed and tenant-scoped', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ day: '2026-09-06', count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ category: 'kyc.identity-document', file_count: 3, total_bytes: 300 }] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);

    const summary = await svc.statsSummary({ tenantId: 't1', windowDays: 7 });

    expect(execute).toHaveBeenCalledTimes(2);
    const dayQuery = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(dayQuery.sql).toMatch(/date_trunc\('day', created_at\)/i);
    expect(dayQuery.sql).toMatch(/tenant_id = /);
    const categoryQuery = dialect.sqlToQuery(execute.mock.calls[1][0] as SQL);
    expect(categoryQuery.sql).toMatch(/group by category/i);
    expect(categoryQuery.sql).toMatch(/tenant_id = /);

    expect(summary.uploadsByDay).toEqual([{ date: '2026-09-06', count: 3 }]);
    expect(summary.byCategory).toEqual([{ category: 'kyc.identity-document', fileCount: 3, totalBytes: 300 }]);
  });

  it('statsSummary defaults windowDays to 30 and never mentions scan_verdict', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.statsSummary({});
    const dayQuery = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const boundCutoff = (dayQuery.params[0] as Date).getTime();
    expect(Math.abs(boundCutoff - thirtyDaysAgo)).toBeLessThan(5000);
    expect(dayQuery.sql).not.toMatch(/scan_verdict/i);
  });

  it('listRejections filters by tenant/category/reason and keysets on (occurred_at, id)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.listRejections({ tenantId: 't1', category: 'kyc.identity-document', reason: 'validation-failed', limit: 10 });

    const q = lastQuery(execute);
    expect(q.sql).toMatch(/from commons_file_rejection/i);
    expect(q.sql).toMatch(/tenant_id = /);
    expect(q.sql).toMatch(/category = /);
    expect(q.sql).toMatch(/reason = /);
    expect(q.sql).toMatch(/order by occurred_at desc, id desc/i);
    expect(q.params).toContain(11);
  });

  it('listRejections returns a nextCursor only when the extra row is present', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `r${i}`, tenant_id: 't1', actor_id: 'u1', category: 'kyc.identity-document',
      filename: 'f.pdf', content_type: 'application/pdf', size_bytes: 1,
      reason: 'validation-failed', message: 'bad', occurred_at: '2026-09-07T00:00:00Z',
    }));
    const execute = vi.fn().mockResolvedValue({ rows });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    const page = await svc.listRejections({ limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('PostgresFileStorageObservabilityService cursors', () => {
  const id = (n: number) => `0b9f6c2e-3c1a-4f7e-9a0b-1c2d3e4f5a6${n}`;

  it("issues the next cursor from the last row's microsecond key — not a millisecond Date", async () => {
    const rows = [0, 1, 2].map((n) => ({
      id: id(n), tenant_id: 't1', category: 'kyc', content_type: 'x', size_bytes: 1, uploaded_by: 'u',
      created_at: '2026-10-29T10:00:00.123Z', created_at_key: `2026-10-29T10:00:00.12345${n}Z`, attachment_count: 0,
    }));
    const svc = new PostgresFileStorageObservabilityService({ execute: vi.fn().mockResolvedValue({ rows }) } as SqlExecutor);
    const page = await svc.listFiles({ limit: 2 });
    expect(decodeKeysetCursor(page.nextCursor!)).toEqual({ timestamp: '2026-10-29T10:00:00.123451Z', id: id(1) });
  });

  it('compares against the cursor at full precision', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.listRejections({ cursor: encodeKeysetCursor('2026-10-29T10:00:00.123451Z', id(1)) });
    const q = lastQuery(execute);
    expect(q.sql).toMatch(/\(occurred_at, id\) < \(\$\d+::timestamptz, \$\d+::uuid\)/);
    expect(q.params).toContain('2026-10-29T10:00:00.123451Z');
  });

  it('throws InvalidFileCursorError for a cursor it never issued', async () => {
    const svc = new PostgresFileStorageObservabilityService({ execute: vi.fn() } as never);
    await expect(svc.listFiles({ cursor: 'nope' })).rejects.toBeInstanceOf(InvalidFileCursorError);
    await expect(svc.getAccessLog('f1', { cursor: 'nope' })).rejects.toBeInstanceOf(InvalidFileCursorError);
  });

  it('filters by hold and by filename, escaping LIKE wildcards', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    await svc.listFiles({ held: true, search: '50%_off' });
    const q = lastQuery(execute);
    expect(q.sql).toMatch(/f\.held_at is not null/);
    expect(q.params).toContain('%50\\%\\_off%');
  });
});
