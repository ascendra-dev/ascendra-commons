import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresFileRetentionStore } from './postgres-file-retention-store';

const dialect = new PgDialect();
const queries = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL));

describe('PostgresFileRetentionStore', () => {
  it('finds expired, unheld files oldest date first', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresFileRetentionStore({ execute } as never).findExpiredFiles(new Date(), 50);
    const q = queries(execute)[0];
    expect(q.sql).toMatch(/retain_until is not null and retain_until <= \$1 and held_at is null/);
    expect(q.sql).toMatch(/order by retain_until, id/);
    expect(q.params).toContain(50);
  });

  it('finds purgeable orphans: no attachment, not held, outside retention, tenant-scoped', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresFileRetentionStore({ execute } as never).findPurgeableOrphans({ olderThan: new Date(), now: new Date(), tenantId: 't1', limit: 10 });
    const q = queries(execute)[0];
    expect(q.sql).toMatch(/not exists \(select 1 from commons_file_attachment/);
    expect(q.sql).toMatch(/f\.held_at is null/);
    expect(q.sql).toMatch(/f\.retain_until is null or f\.retain_until <= /);
    expect(q.sql).toMatch(/f\.tenant_id = /);
  });

  it('previews an orphan purge with the same bounds — what goes, what stays held, what stays retained', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ purgeable: '3', purgeable_bytes: '300', held: '1', retained: '9' }] });
    const preview = await new PostgresFileRetentionStore({ execute } as never).previewOrphanPurge({ olderThan: new Date(), now: new Date(), tenantId: 't1' });
    expect(preview).toEqual({ purgeable: { count: 3, bytes: 300 }, held: 1, retained: 9 });
    const q = queries(execute)[0];
    expect(q.sql).toMatch(/not exists \(select 1 from commons_file_attachment/);
    expect(q.sql).toMatch(/f\.tenant_id = /);
    expect(q.sql).not.toMatch(/delete/i);
  });

  it('prunes a log in batches until a short batch', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] });
    expect(await new PostgresFileRetentionStore({ execute } as never).pruneAccessLog(new Date(), 2)).toBe(3);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(queries(execute)[0].sql).toMatch(/delete from commons_file_access where id in \(select id from doomed\)/);
  });

  it('volume counts files, both logs, and filters by tenant when asked', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '4', total_bytes: '100', past_retention: '1', expiring_soon: '1', indefinite: '2', held: '1', oldest: '2026-01-01T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [{ rows: '9', oldest: null }] })
      .mockResolvedValueOnce({ rows: [{ rows: '0', oldest: null }] });
    const v = await new PostgresFileRetentionStore({ execute } as never).volume(new Date(), 't1');
    expect(v.files).toMatchObject({ count: 4, totalBytes: 100, pastRetention: 1, held: 1, indefinite: 2 });
    expect(v.accessLog).toEqual({ rows: 9, oldestAt: null });
    expect(queries(execute).every((q) => /where tenant_id = /.test(q.sql))).toBe(true);
  });

  it('findRecordedRefs looks the refs up in one query', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ file_ref: 'b/a' }] });
    const found = await new PostgresFileRetentionStore({ execute } as never).findRecordedRefs(['b/a', 'b/z']);
    expect([...found]).toEqual(['b/a']);
    expect(queries(execute)[0].sql).toMatch(/file_ref = any\(ARRAY\[\$1, \$2\]::text\[\]\)/);
    expect(await new PostgresFileRetentionStore({ execute } as never).findRecordedRefs([])).toEqual(new Set());
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
