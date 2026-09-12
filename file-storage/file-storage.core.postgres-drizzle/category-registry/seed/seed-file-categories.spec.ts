import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { seedFileCategories } from './seed-file-categories';
import type { FileCategory } from '../../../file-storage.core';
import type { SqlExecutor } from '../../persistence/sql-executor';

const dialect = new PgDialect();

describe('seedFileCategories', () => {
  it('inserts each base category as a tenant_id NULL / source seed row, insert-if-absent', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const db = { execute } as SqlExecutor;
    const cats: FileCategory[] = [
      {
        key: 'kyc.identity-document',
        label: 'ID',
        bucket: 'kyc',
        allowedContentTypes: ['application/pdf'],
        allowedExtensions: ['pdf'],
        maxSizeBytes: 8000,
        minSizeBytes: 10,
        onUnscannable: 'reject',
        retention: { keepForDays: 2555 },
      },
    ];
    await seedFileCategories(db, cats);

    const q = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(q.sql).toMatch(/insert into commons_file_category/i);
    expect(q.sql).toMatch(/values\s*\(\$\d+, null, 'seed', true/i);
    expect(q.sql).toMatch(/on conflict \(key\) where tenant_id is null do nothing/i);
    expect(q.params).toContain('kyc.identity-document');
    expect(q.params).toContain(JSON.stringify({ keepForDays: 2555 }));
  });

  it('does nothing for an empty list', async () => {
    const execute = vi.fn();
    await seedFileCategories({ execute } as SqlExecutor, []);
    expect(execute).not.toHaveBeenCalled();
  });
});
