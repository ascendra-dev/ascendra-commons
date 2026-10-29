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

  it('statsSummary counts whole calendar days in the viewer zone, every day present, uploads and refusals together', async () => {
    const sqls: string[] = [];
    const execute = vi.fn(async (q: SQL) => {
      const text = dialect.sqlToQuery(q).sql;
      sqls.push(text);
      if (/as since/.test(text)) return { rows: [{ since: '2026-10-26T20:00:00Z' }] };
      if (/from commons_file_record where .* group by 1/.test(text) && /as uploads/.test(text)) return { rows: [{ day: '2026-10-28', uploads: '2', bytes: '300' }] };
      if (/as rejected\s+from commons_file_rejection where .* group by 1/.test(text)) return { rows: [{ day: '2026-10-29', rejected: '1' }] };
      if (/as file_count/.test(text)) return { rows: [{ category: 'kyc', file_count: '2', total_bytes: '300' }] };
      if (/group by category/.test(text)) return { rows: [{ category: 'avatar', rejected: '1' }] };
      if (/scan_verdict/.test(text)) return { rows: [{ verdict: 'clean', count: '1' }, { verdict: 'unscannable', count: '1' }] };
      return { rows: [{ reason: 'validation-failed', count: '1' }] };
    });
    const svc = new PostgresFileStorageObservabilityService({ execute } as SqlExecutor);
    const now = new Date('2026-10-29T12:00:00Z');
    const s = await svc.statsSummary({ tenantId: 't1', windowDays: 3, timeZone: 'Asia/Dubai' }, now);

    expect(s.byDay).toEqual([
      { date: '2026-10-27', uploads: 0, bytes: 0, rejected: 0 },
      { date: '2026-10-28', uploads: 2, bytes: 300, rejected: 0 },
      { date: '2026-10-29', uploads: 0, bytes: 0, rejected: 1 },
    ]);
    expect(s.since).toEqual(new Date('2026-10-26T20:00:00Z'));
    expect(s.totals).toEqual({ uploads: 2, bytes: 300, rejected: 1, unscannable: 1 });
    expect(s.byCategory).toEqual([
      { category: 'avatar', fileCount: 0, totalBytes: 0, rejected: 1 },
      { category: 'kyc', fileCount: 2, totalBytes: 300, rejected: 0 },
    ]);
    expect(s.byRejectionReason).toEqual([{ reason: 'validation-failed', count: 1 }]);
    expect(sqls.filter((q) => /at time zone \$\d+, 'YYYY-MM-DD'/.test(q))).toHaveLength(2);
    expect(sqls.slice(1).every((q) => /tenant_id = /.test(q))).toBe(true);
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
