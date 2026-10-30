import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotImplementedException } from '@nestjs/common';
import { FileRetentionApiService } from './file-retention-api.service';
import { NotAStrayBlobError, resolveFileStorageOptions, StrayBlobListingUnsupportedError } from '../../file-storage.core';

const tenantAdmin = { id: 'ta', persona: 'ops', tenantId: 't1' };
const platformAdmin = { id: 'pa', persona: 'ops', tenantId: null };

function make() {
  const retention = {
    volume: vi.fn().mockResolvedValue({}),
    run: vi.fn().mockResolvedValue({ filesDeleted: 0 }),
    purgeOrphans: vi.fn().mockResolvedValue({ deleted: 0, bytesFreed: 0 }),
    previewOrphanPurge: vi.fn().mockResolvedValue({ purgeable: { count: 0, bytes: 0 }, held: 0, retained: 0 }),
    findStrayBlobs: vi.fn().mockRejectedValue(new StrayBlobListingUnsupportedError()),
    deleteStrayBlob: vi.fn().mockRejectedValue(new NotAStrayBlobError('b/x')),
  };
  return { svc: new FileRetentionApiService(retention as never, resolveFileStorageOptions({})), retention };
}

describe('FileRetentionApiService', () => {
  it("scopes a tenant actor's volume and purge to their tenant, and refuses another", async () => {
    const { svc, retention } = make();
    await svc.volume(tenantAdmin);
    await svc.purgeOrphans(tenantAdmin, { olderThanDays: 7 });
    expect(retention.volume).toHaveBeenCalledWith('t1');
    expect(retention.purgeOrphans).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', actor: tenantAdmin }));
    await expect(svc.purgeOrphans(tenantAdmin, { olderThanDays: 7, tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("previews a purge in the actor's scope, with the same cutoff", async () => {
    const { svc, retention } = make();
    const before = Date.now();
    await svc.previewOrphanPurge(tenantAdmin, { olderThanDays: 30 });
    const arg = retention.previewOrphanPurge.mock.calls[0][0];
    expect(arg.tenantId).toBe('t1');
    expect(before - (arg.olderThan as Date).getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 5);
    await expect(svc.previewOrphanPurge(tenantAdmin, { olderThanDays: 30, tenantId: 't2' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('runs retention for a platform admin only', async () => {
    const { svc, retention } = make();
    await expect(svc.runNow(tenantAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await svc.runNow(platformAdmin);
    expect(retention.run).toHaveBeenCalled();
  });

  it('turns olderThanDays into a cutoff', async () => {
    const { svc, retention } = make();
    const before = Date.now();
    await svc.purgeOrphans(platformAdmin, { olderThanDays: 2 });
    const cutoff = retention.purgeOrphans.mock.calls[0][0].olderThan as Date;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(2 * 86_400_000 - 5);
  });

  it('stray blobs: platform only; unsupported → 501, recorded → 409', async () => {
    const { svc } = make();
    await expect(svc.findStrayBlobs(tenantAdmin, { bucket: 'b' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.findStrayBlobs(platformAdmin, { bucket: 'b' })).rejects.toBeInstanceOf(NotImplementedException);
    await expect(svc.deleteStrayBlob(platformAdmin, 'b/x')).rejects.toBeInstanceOf(ConflictException);
  });
});
