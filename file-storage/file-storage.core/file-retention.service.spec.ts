import { describe, expect, it, vi } from 'vitest';
import { FileRetentionService, RETENTION_ACTOR } from './file-retention.service';
import { resolveFileStorageOptions } from './file-storage.options';
import type { FileRecord } from './file-record.interface';

const DAY = 86_400_000;
const rec = (id: string, over: Partial<FileRecord> = {}): FileRecord => ({
  id, tenantId: 't1', fileRef: `b/${id}`, category: 'kyc', contentType: 'application/pdf', sizeBytes: 10,
  contentHash: null, uploadedBy: 'u', filename: `${id}.pdf`, scanVerdict: 'clean', retainUntil: new Date(0),
  legalHold: null, createdAt: new Date(0), ...over,
});

function make(over: { expired?: FileRecord[][]; orphans?: FileRecord[]; deleteReturns?: (id: string) => FileRecord | null; blobFails?: boolean } = {}) {
  const batches = [...(over.expired ?? [])];
  const retention = {
    findExpiredFiles: vi.fn(async () => batches.shift() ?? []),
    findPurgeableOrphans: vi.fn(async () => over.orphans ?? []),
    pruneAccessLog: vi.fn().mockResolvedValue(7),
    pruneRejections: vi.fn().mockResolvedValue(3),
    volume: vi.fn().mockResolvedValue({ files: {}, accessLog: {}, rejections: {} }),
  };
  const store = { deleteFileCascade: vi.fn(async (id: string) => (over.deleteReturns ? over.deleteReturns(id) : rec(id))) };
  const fileStore = { delete: vi.fn(over.blobFails ? () => Promise.reject(new Error('gone')) : () => Promise.resolve()) };
  const audit = { emit: vi.fn().mockResolvedValue(undefined) };
  const svc = new FileRetentionService(retention as never, store as never, fileStore as never, audit, resolveFileStorageOptions({ logRetention: { accessLogDays: 10 } }));
  return { svc, retention, store, fileStore, audit };
}

describe('FileRetentionService.run', () => {
  it('deletes expired files (re-checking the date in the delete), their blobs, audits each, prunes both logs', async () => {
    const now = new Date('2026-10-29T00:00:00Z');
    const { svc, store, fileStore, audit, retention } = make({ expired: [[rec('a'), rec('b')]] });
    const res = await svc.run({ now });
    expect(store.deleteFileCascade).toHaveBeenCalledWith('a', { onlyIf: { expiredBy: now } });
    expect(fileStore.delete).toHaveBeenCalledWith('b/a');
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.deleted', cause: 'retention', actor: RETENTION_ACTOR }));
    expect(retention.pruneAccessLog).toHaveBeenCalledWith(new Date(now.getTime() - 10 * DAY), expect.any(Number));
    expect(retention.pruneRejections).toHaveBeenCalledWith(new Date(now.getTime() - 90 * DAY), expect.any(Number));
    expect(res).toEqual({ filesDeleted: 2, bytesFreed: 20, blobDeleteFailures: 0, accessLogRowsDeleted: 7, rejectionRowsDeleted: 3 });
  });

  it('skips a file held since it was found, and stops when a whole batch made no progress', async () => {
    const { svc, retention } = make({ expired: [[rec('held')], [rec('held')]], deleteReturns: () => null });
    const res = await svc.run();
    expect(res.filesDeleted).toBe(0);
    expect(retention.findExpiredFiles).toHaveBeenCalledTimes(1);
  });

  it('counts a failed blob delete — the record is gone, the blob is a stray', async () => {
    const { svc } = make({ expired: [[rec('a')]], blobFails: true });
    expect((await svc.run()).blobDeleteFailures).toBe(1);
  });

  it('stops at maxFiles', async () => {
    const { svc, retention } = make({ expired: [[rec('a')], [rec('b')], [rec('c')]] });
    expect((await svc.run({ maxFiles: 2 })).filesDeleted).toBe(2);
    expect(retention.findExpiredFiles).toHaveBeenLastCalledWith(expect.any(Date), 1);
  });
});

describe('FileRetentionService.purgeOrphans', () => {
  it('deletes only still-orphaned files outside retention, audited with the actor', async () => {
    const actor = { id: 'ta', persona: 'ops', tenantId: 't1' };
    const kept = rec('kept', { retainUntil: new Date(Date.now() + DAY) });
    const { svc, store, audit, retention } = make({ orphans: [rec('o1'), kept] });
    const res = await svc.purgeOrphans({ actor, olderThan: new Date(), tenantId: 't1' });
    expect(retention.findPurgeableOrphans).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    expect(store.deleteFileCascade).toHaveBeenCalledTimes(1);
    expect(store.deleteFileCascade).toHaveBeenCalledWith('o1', { onlyIf: { orphaned: true } });
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ cause: 'orphan-purge', actor }));
    expect(res).toEqual({ deleted: 1, bytesFreed: 10 });
  });
});

describe('FileRetentionService.volume', () => {
  it('adds the log policy to the store volume', async () => {
    const { svc, retention } = make();
    const v = await svc.volume('t1');
    expect(retention.volume).toHaveBeenCalledWith(expect.any(Date), 't1');
    expect(v.policy).toEqual({ accessLogDays: 10, rejectionLogDays: 90 });
  });
});

describe('resolveFileStorageOptions logRetention', () => {
  it('refuses a non-positive or fractional day count', () => {
    expect(() => resolveFileStorageOptions({ logRetention: { accessLogDays: 0 } })).toThrow(/accessLogDays/);
    expect(() => resolveFileStorageOptions({ logRetention: { rejectionLogDays: 1.5 } })).toThrow(/rejectionLogDays/);
  });
});
