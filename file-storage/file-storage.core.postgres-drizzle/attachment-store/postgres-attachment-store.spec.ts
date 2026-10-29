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
      fileRecord: {
        tenantId: 't1', fileRef: 'kyc/f1', category: 'kyc', contentType: 'application/pdf', sizeBytes: 12, contentHash: 'h',
        uploadedBy: 'u1', filename: 'a.pdf', scanVerdict: 'clean', retainUntil: null,
      },
      attachment: { attachedToType: 'invoice', attachedToId: 'inv1', category: 'kyc' },
    });

    const q = rendered(db)[0];
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(q.sql).toMatch(/with fr as \(\s*insert into commons_file_record/i);
    expect(q.sql).toMatch(/at as \(\s*insert into commons_file_attachment/i);
    expect(res.fileRecord.id).toBe('f1');
    expect(res.fileRecord.sizeBytes).toBe(12);
    expect(res.attachment.id).toBe('a1');
    expect(q.params).toEqual(expect.arrayContaining(['a.pdf', 'clean']));
  });
});

describe('PostgresAttachmentStore.findByEntity', () => {
  it('filters by tenant when asked', async () => {
    const db = fakeDb([]);
    await new PostgresAttachmentStore(db).findByEntity('invoice', 'i1', { tenantId: 't1' });
    const q = rendered(db)[0];
    expect(q.sql).toMatch(/and f\.tenant_id = /);
    expect(q.params).toEqual(['invoice', 'i1', 't1']);
  });
});

describe('PostgresAttachmentStore.deleteFileCascade', () => {
  it('deletes the attachment rows then the file record, one statement — the access log stays', async () => {
    const db = fakeDb([
      { id: 'f1', tenant_id: 't1', file_ref: 'kyc/f1', category: 'kyc', content_type: 'application/pdf', size_bytes: 1, content_hash: null, uploaded_by: 'u', created_at: '2026-09-07T00:00:00Z' },
    ]);
    const store = new PostgresAttachmentStore(db);
    const removed = await store.deleteFileCascade('f1');

    const q = rendered(db)[0];
    expect(q.sql).not.toMatch(/commons_file_access/i);
    expect(q.sql).toMatch(/f\.held_at is null\s+for update/i);
    expect(q.sql).toMatch(/delete from commons_file_attachment where file_record_id in \(select id from target\)/i);
    expect(q.sql).toMatch(/delete from commons_file_record where id in \(select id from target\)/i);
    expect(removed?.fileRef).toBe('kyc/f1');
  });

  it('onlyIf re-checks expiry and orphanhood inside the same statement', async () => {
    const db = fakeDb([]);
    const by = new Date('2026-10-29T00:00:00Z');
    await new PostgresAttachmentStore(db).deleteFileCascade('f1', { onlyIf: { expiredBy: by, orphaned: true } });
    const q = rendered(db)[0];
    expect(q.sql).toMatch(/f\.retain_until is not null and f\.retain_until <= /);
    expect(q.sql).toMatch(/not exists \(select 1 from commons_file_attachment a where a\.file_record_id = f\.id\)/);
    expect(q.params).toContain(by);
  });

  it('returns null when the record did not exist', async () => {
    const store = new PostgresAttachmentStore(fakeDb([]));
    expect(await store.deleteFileCascade('gone')).toBeNull();
  });
});

describe('PostgresAttachmentStore.setLegalHold', () => {
  it('sets or clears the three hold columns in one update', async () => {
    const db = fakeDb([{ id: 'f1', tenant_id: 't1', file_ref: 'r', category: 'c', content_type: 'x', size_bytes: 1, uploaded_by: 'u', created_at: '2026-01-01T00:00:00Z', held_at: '2026-01-02T00:00:00Z', held_by: 'counsel', hold_reason: 'dispute' }]);
    const res = await new PostgresAttachmentStore(db).setLegalHold('f1', { heldAt: new Date('2026-01-02T00:00:00Z'), heldBy: 'counsel', reason: 'dispute' });
    expect(rendered(db)[0].sql).toMatch(/update commons_file_record\s+set held_at = .*, held_by = .*, hold_reason = /i);
    expect(res?.legalHold).toEqual({ heldAt: new Date('2026-01-02T00:00:00Z'), heldBy: 'counsel', reason: 'dispute' });

    const clear = fakeDb([]);
    expect(await new PostgresAttachmentStore(clear).setLegalHold('gone', null)).toBeNull();
    expect(rendered(clear)[0].params.slice(0, 3)).toEqual([null, null, null]);
  });
});
