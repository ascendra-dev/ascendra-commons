import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresFileCategoryAdminService } from './postgres-file-category-admin.service';
import { CategoryCache } from './category-cache';
import { CategoryNotFoundError } from '../../file-storage.core';

const dialect = new PgDialect();
const base = { key: 'kyc', tenant_id: null, label: 'KYC', bucket: 'kyc', allowed_extensions: ['pdf'], max_size_bytes: 1000, active: false };

function make(rowsFor: (q: string) => Array<Record<string, unknown>>) {
  const execute = vi.fn(async (s: SQL) => ({ rows: rowsFor(dialect.sqlToQuery(s).sql) }));
  const cache = new CategoryCache(60_000);
  const clear = vi.spyOn(cache, 'clear');
  return { svc: new PostgresFileCategoryAdminService({ execute } as never, cache), execute, clear };
}

describe('PostgresFileCategoryAdminService', () => {
  it('deactivating an unknown key throws CategoryNotFoundError and writes nothing', async () => {
    const { svc, execute } = make(() => []);
    await expect(svc.deactivateCategory('t1', 'nope')).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('activateBaseCategory turns the base row on and clears the cache', async () => {
    const { svc, execute, clear } = make((q) => (q.startsWith('update') ? [] : [base]));
    const view = await svc.activateBaseCategory('kyc');
    const sqls = execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL).sql);
    expect(sqls.some((q) => /update commons_file_category set active = true/.test(q) && /tenant_id is null/.test(q))).toBe(true);
    expect(clear).toHaveBeenCalled();
    expect(view.key).toBe('kyc');
  });

  it('an override that only tightens the size stores a NULL extension list — and still reads back the base list', async () => {
    const override = { key: 'kyc', tenant_id: 't1', max_size_bytes: 500, allowed_extensions: null, active: true };
    const { svc } = make(() => [{ ...base, active: true }, override]);
    const view = await svc.upsertTenantOverride('t1', 'kyc', { maxSizeBytes: 500 });
    expect(view.effective.allowedExtensions).toEqual(['pdf']);
    expect(view.effective.maxSizeBytes).toBe(500);
  });
});
