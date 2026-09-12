import { describe, expect, it, vi } from 'vitest';
import { PostgresFileCategoryRegistry } from './postgres-file-category-registry';
import { CategoryCache } from './category-cache';
import type { SqlExecutor } from '../persistence/sql-executor';

function baseRow(over: Record<string, unknown> = {}) {
  return {
    key: 'kyc.identity-document',
    tenant_id: null,
    label: 'ID',
    description: null,
    bucket: 'kyc',
    retention: 'indefinite',
    allowed_content_types: ['application/pdf'],
    max_size_bytes: 8000,
    min_size_bytes: 10,
    allowed_extensions: ['pdf'],
    on_unscannable: 'reject',
    signed_link_expiry_seconds: 300,
    active: true,
    ...over,
  };
}

describe('PostgresFileCategoryRegistry.resolve', () => {
  it('returns null when there is no base row', async () => {
    const db: SqlExecutor = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const reg = new PostgresFileCategoryRegistry(db, new CategoryCache(0));
    expect(await reg.resolve('t1', 'nope')).toBeNull();
  });

  it('merges base with the tenant override', async () => {
    const db: SqlExecutor = {
      execute: vi.fn().mockResolvedValue({
        rows: [baseRow(), { ...baseRow(), tenant_id: 't1', max_size_bytes: 4000, source: 'tenant' }],
      }),
    };
    const reg = new PostgresFileCategoryRegistry(db, new CategoryCache(0));
    const resolved = await reg.resolve('t1', 'kyc.identity-document');
    expect(resolved?.maxSizeBytes).toBe(4000);
    expect(resolved?.allowedContentTypes).toEqual(['application/pdf']);
  });

  it('caches within the TTL — a second resolve does not hit the db', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [baseRow()] });
    const reg = new PostgresFileCategoryRegistry({ execute }, new CategoryCache(60_000));
    await reg.resolve('t1', 'kyc.identity-document');
    await reg.resolve('t1', 'kyc.identity-document');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
