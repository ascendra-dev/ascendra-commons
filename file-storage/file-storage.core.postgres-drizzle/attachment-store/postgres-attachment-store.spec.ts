import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAttachmentStore } from './postgres-attachment-store';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();
const rendered = (db: { execute: ReturnType<typeof vi.fn> }) =>
  db.execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as SQL));

function fakeDb(rows: Array<Record<string, unknown>> = []): SqlExecutor & { execute: ReturnType<typeof vi.fn> } {
  return { execute: vi.fn().mockResolvedValue({ rows }) } as never;
}

describe('PostgresAttachmentStore.attach', () => {
  it('is a single writable-CTE statement inserting both rows', async () => {
    const db = fakeDb([
      {
        fr_id: 'f1', tenant_id: 't1', file_ref: 'kyc/f1', fr_category: 'kyc', content_type: 'application/pdf',
        size_bytes: 12, content_hash: 'h', uploaded_by: 'u1', fr_created_at: '2026-09-07T00:00:00Z',
        at_id: 'a1', file_record_id: 'f1', attached_to_type: 'invoice', attached_to_id: 'inv1',
        at_category: 'kyc', at_created_at: '2026-09-07T00:00:00Z',
      },
    ]);
    const store = new PostgresAttachmentStore(db);
    const res = await store.attach({
      fileRecord: { tenantId: 't1', fileRef: 'kyc/f1', category: 'kyc', contentType: 'application/pdf', sizeBytes: 12, contentHash: 'h', uploadedBy: 'u1' },
      attachment: { attachedToType: 'invoice', attachedToId: 'inv1', category: 'kyc' },
    });

    const q = rendered(db)[0];
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(q.sql).toMatch(/with fr as \(\s*insert into commons_file_record/i);
    expect(q.sql).toMatch(/at as \(\s*insert into commons_attachment/i);
    expect(res.fileRecord.id).toBe('f1');
    expect(res.fileRecord.sizeBytes).toBe(12);
    expect(res.attachment.id).toBe('a1');
  });
});

describe('PostgresAttachmentStore.deleteFileCascade', () => {
  it('deletes access + attachment rows then the file record, one statement', async () => {
    const db = fakeDb([
      { id: 'f1', tenant_id: 't1', file_ref: 'kyc/f1', category: 'kyc', content_type: 'application/pdf', size_bytes: 1, content_hash: null, uploaded_by: 'u', created_at: '2026-09-07T00:00:00Z' },
    ]);
    const store = new PostgresAttachmentStore(db);
    const removed = await store.deleteFileCascade('f1');

    const q = rendered(db)[0];
    expect(q.sql).toMatch(/with del_access as \(delete from commons_file_access/i);
    expect(q.sql).toMatch(/del_attach as \(delete from commons_attachment/i);
    expect(q.sql).toMatch(/delete from commons_file_record where id = /i);
    expect(removed?.fileRef).toBe('kyc/f1');
  });

  it('returns null when the record did not exist', async () => {
    const store = new PostgresAttachmentStore(fakeDb([]));
    expect(await store.deleteFileCascade('gone')).toBeNull();
  });
});
