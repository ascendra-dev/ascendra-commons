import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresPendingUploadStore } from './postgres-pending-upload-store';

const dialect = new PgDialect();
const id = '0b9f6c2e-3c1a-4f7e-9a0b-1c2d3e4f5a6b';
const row = {
  id, tenant_id: 't1', actor_id: 'u1', category: 'kyc', attached_to_type: 'issuer', attached_to_id: 'i1', filename: 'a.pdf',
  content_type: 'application/pdf', size_bytes: '14', file_ref: 'kyc/t1/x', expires_at: '2026-10-29T10:15:00Z', created_at: '2026-10-29T10:00:00Z',
};

describe('PostgresPendingUploadStore', () => {
  it('creates and reads an upload', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [row] });
    const store = new PostgresPendingUploadStore({ execute } as never);
    const created = await store.create({ ...{ tenantId: 't1', actorId: 'u1', category: 'kyc', attachedToType: 'issuer', attachedToId: 'i1', filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 14, fileRef: 'kyc/t1/x' }, expiresAt: new Date() });
    expect(created).toMatchObject({ id, sizeBytes: 14, expiresAt: new Date('2026-10-29T10:15:00Z') });
    expect(await store.get(id)).toMatchObject({ fileRef: 'kyc/t1/x' });
  });

  it('a non-uuid id names nothing — no query', async () => {
    const execute = vi.fn();
    const store = new PostgresPendingUploadStore({ execute } as never);
    expect(await store.get('nope')).toBeNull();
    expect(await store.delete('nope')).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('delete reports whether it removed the row — the claim two completes race for', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ id }] }).mockResolvedValueOnce({ rows: [] });
    const store = new PostgresPendingUploadStore({ execute } as never);
    expect(await store.delete(id)).toBe(true);
    expect(await store.delete(id)).toBe(false);
  });

  it('finds expired uploads oldest first', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresPendingUploadStore({ execute } as never).findExpired(new Date(), 10);
    expect(dialect.sqlToQuery(execute.mock.calls[0][0] as SQL).sql).toMatch(/where expires_at <= \$1 order by expires_at limit \$2/);
  });
});
