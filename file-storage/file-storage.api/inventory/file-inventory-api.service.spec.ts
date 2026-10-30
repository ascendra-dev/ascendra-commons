import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileInventoryApiService } from './file-inventory-api.service';
import { InvalidFileCursorError, resolveFileStorageOptions } from '../../file-storage.core';
import type { Actor } from '../../../authorization/authorization.core';

const tenantAdmin: Actor = { id: 'ta', persona: 'ops', tenantId: 't1' };
const platformAdmin: Actor = { id: 'pa', persona: 'ops', tenantId: null };
const detail = (tenantId = 't1') => ({ fileRecord: { id: 'f1', tenantId }, attachments: [{ id: 'a1', fileRecordId: 'f1' }] });

function make(over: { getFile?: unknown; listFiles?: unknown } = {}) {
  const port = {
    listFiles: vi.fn(over.listFiles ? (over.listFiles as () => Promise<unknown>) : async () => ({ rows: [], nextCursor: null })),
    getFile: vi.fn().mockResolvedValue('getFile' in over ? over.getFile : detail()),
    storageUsage: vi.fn().mockResolvedValue([]),
    listOrphanedFileRecords: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    getAccessLog: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    categoryUsage: vi.fn().mockResolvedValue([]),
    statsSummary: vi.fn().mockResolvedValue({ uploadsByDay: [], byCategory: [] }),
    listRejections: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    listDuplicates: vi.fn().mockResolvedValue([]),
  };
  const attachments = {
    getDownloadUrl: vi.fn().mockResolvedValue('https://url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    placeLegalHold: vi.fn().mockResolvedValue({ id: 'f1' }),
    releaseLegalHold: vi.fn().mockResolvedValue({ id: 'f1' }),
  };
  const audit = { record: vi.fn() };
  const svc = new FileInventoryApiService(port as never, attachments as never, resolveFileStorageOptions({}), audit as never);
  return { svc, port, attachments, audit };
}

describe('FileInventoryApiService tenant scoping', () => {
  it('forces a non-platform actor to their own tenant on every list', async () => {
    const { svc, port } = make();
    await svc.listFiles(tenantAdmin, { tenantId: 't2' });
    await svc.stats(tenantAdmin, { tenantId: 't2', windowDays: 7 });
    await svc.listRejections(tenantAdmin, { tenantId: 't2', reason: 'validation-failed' });
    await svc.listOrphans(tenantAdmin, { tenantId: 't2' });
    await svc.listDuplicates(tenantAdmin, { tenantId: 't2' });
    expect(port.listDuplicates).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    expect(port.listFiles).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    expect(port.statsSummary).toHaveBeenCalledWith({ tenantId: 't1', windowDays: 7 });
    expect(port.listRejections).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', reason: 'validation-failed' }));
    expect(port.listOrphanedFileRecords).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
  });

  it('lets a platform admin filter by any tenant, or none', async () => {
    const { svc, port } = make();
    await svc.listFiles(platformAdmin, { tenantId: 't9' });
    await svc.stats(platformAdmin, {});
    expect(port.listFiles).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
    expect(port.statsSummary).toHaveBeenCalledWith({ tenantId: undefined });
  });

  it('refuses a non-platform actor with no tenant', async () => {
    const { port, attachments, audit } = make();
    const strict = new FileInventoryApiService(port as never, attachments as never, resolveFileStorageOptions({ isPlatformAdmin: () => false }), audit as never);
    await expect(strict.listFiles({ id: 'x', persona: 'p', tenantId: null }, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getFile 404s an unknown id and 403s another tenant', async () => {
    await expect(make({ getFile: null }).svc.getFile(tenantAdmin, 'x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(make({ getFile: detail('t2') }).svc.getFile(tenantAdmin, 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a cursor the adapter cannot decode is a 400', async () => {
    const { svc } = make({ listFiles: async () => Promise.reject(new InvalidFileCursorError('zzz')) });
    await expect(svc.listFiles(tenantAdmin, { cursor: 'zzz' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FileInventoryApiService content', () => {
  it('getFile returns the record without minting a URL — opening it is its own action', async () => {
    const { svc, attachments } = make();
    const res = await svc.getFile(tenantAdmin, 'f1');
    expect(res).not.toHaveProperty('url');
    expect(attachments.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("issueDownloadUrl mints an in-app URL and audits a content view against the file's tenant", async () => {
    const { svc, attachments, audit } = make({ getFile: detail('t7') });
    const res = await svc.issueDownloadUrl(platformAdmin, 'f1');
    expect(res.url).toBe('https://url');
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(attachments.getDownloadUrl).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: platformAdmin, purpose: 'in-app' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.content_viewed', tenantId: 't7', entityId: 'f1' }));
  });

  it("issueDownloadUrl refuses another tenant's file before minting anything", async () => {
    const { svc, attachments } = make({ getFile: detail('t2') });
    await expect(svc.issueDownloadUrl(tenantAdmin, 'f1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(attachments.getDownloadUrl).not.toHaveBeenCalled();
  });
});

describe('FileInventoryApiService mutations', () => {
  it('deleteFile delegates to AttachmentService, which audits it — no second event here', async () => {
    const { svc, attachments, audit } = make();
    await svc.deleteFile(tenantAdmin, 'f1');
    expect(attachments.deleteFile).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: tenantAdmin });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("a platform admin's early delete is an erasure — it needs a reason, which goes to AttachmentService", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const { svc, attachments } = make({ getFile: { fileRecord: { id: 'f1', tenantId: 't1', retainUntil: future, legalHold: null }, attachments: [] } });
    await expect(svc.deleteFile(platformAdmin, 'f1')).rejects.toBeInstanceOf(BadRequestException);
    expect(attachments.deleteFile).not.toHaveBeenCalled();
    await svc.deleteFile(platformAdmin, 'f1', 'erasure request #88');
    expect(attachments.deleteFile).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: platformAdmin, reason: 'erasure request #88' });
  });

  it("a tenant admin's early delete goes to AttachmentService, which refuses it (409) — no reason asked first", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const { svc, attachments } = make({ getFile: { fileRecord: { id: 'f1', tenantId: 't1', retainUntil: future, legalHold: null }, attachments: [] } });
    await svc.deleteFile(tenantAdmin, 'f1');
    expect(attachments.deleteFile).toHaveBeenCalled();
  });

  it("detach 404s an attachment that isn't on this file", async () => {
    const { svc, attachments } = make();
    await expect(svc.detach(tenantAdmin, 'f1', 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(attachments.detach).not.toHaveBeenCalled();
    await svc.detach(tenantAdmin, 'f1', 'a1');
    expect(attachments.detach).toHaveBeenCalledWith({ attachmentId: 'a1', actor: tenantAdmin });
  });

  it('legal holds delegate to AttachmentService', async () => {
    const { svc, attachments } = make();
    await svc.placeLegalHold(tenantAdmin, 'f1', 'dispute');
    await svc.releaseLegalHold(tenantAdmin, 'f1');
    expect(attachments.placeLegalHold).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: tenantAdmin, reason: 'dispute' });
    expect(attachments.releaseLegalHold).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: tenantAdmin });
  });
});

describe('FileInventoryApiService names', () => {
  it('adds the uploader and the holder by name, one directory call per page', async () => {
    const { port, attachments, audit } = make({
      getFile: { fileRecord: { id: 'f1', tenantId: 't1', uploadedBy: 'u1', legalHold: { heldBy: 'u2' } }, attachments: [] },
      listFiles: async () => ({ rows: [{ uploadedBy: 'u1' }, { uploadedBy: 'u9' }], nextCursor: null }),
    });
    const directory = { findByIds: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Hana Ito' }, { id: 'u2', name: 'Li Wei' }]) };
    const svc = new FileInventoryApiService(port as never, attachments as never, resolveFileStorageOptions({}), audit as never, directory);
    const page = await svc.listFiles(tenantAdmin, {});
    expect(page.rows.map((r) => r.uploadedByName)).toEqual(['Hana Ito', null]);
    expect(directory.findByIds).toHaveBeenCalledTimes(1);
    expect(await svc.getFile(tenantAdmin, 'f1')).toMatchObject({ uploadedByName: 'Hana Ito', heldByName: 'Li Wei' });
  });

  it('without a directory, names are null', async () => {
    const { svc } = make({ listFiles: async () => ({ rows: [{ uploadedBy: 'u1' }], nextCursor: null }) });
    expect((await svc.listFiles(tenantAdmin, {})).rows[0].uploadedByName).toBeNull();
  });
});
