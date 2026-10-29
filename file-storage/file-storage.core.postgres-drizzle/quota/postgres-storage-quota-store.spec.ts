import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresStorageQuotaStore } from './postgres-storage-quota-store';

const dialect = new PgDialect();
const q = (execute: ReturnType<typeof vi.fn>, i = 0) => dialect.sqlToQuery(execute.mock.calls[i][0] as SQL);
const row = { tenant_id: 't1', max_bytes: '1000', updated_at: '2026-10-29T00:00:00Z', updated_by: 'pa' };

describe('PostgresStorageQuotaStore', () => {
  it('reads a limit and the usage', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ used: '640' }] });
    const store = new PostgresStorageQuotaStore({ execute } as never);
    expect(await store.getQuota('t1')).toMatchObject({ tenantId: 't1', maxBytes: 1000 });
    expect(await store.usage('t1')).toBe(640);
    expect(q(execute, 1).sql).toMatch(/coalesce\(sum\(size_bytes\), 0\) as used from commons_file_record where tenant_id = /);
  });

  it('upserts and deletes a limit', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [row] });
    const store = new PostgresStorageQuotaStore({ execute } as never);
    await store.setQuota('t1', 1000, 'pa');
    expect(q(execute).sql).toMatch(/on conflict \(tenant_id\) do update set max_bytes = excluded\.max_bytes/);
    expect(await store.clearQuota('t1')).toMatchObject({ maxBytes: 1000 });
  });

  it('lists limits with usage, optionally one tenant', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ ...row, used_bytes: '640', file_count: '3' }] });
    const list = await new PostgresStorageQuotaStore({ execute } as never).listQuotas('t1');
    expect(list).toEqual([expect.objectContaining({ tenantId: 't1', usedBytes: 640, fileCount: 3 })]);
    expect(q(execute).sql).toMatch(/where q\.tenant_id = /);
  });
});
