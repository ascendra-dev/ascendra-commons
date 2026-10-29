import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { FileInventoryApiService } from './file-inventory-api.service';
import type { Actor } from '../../../authorization/authorization.core';

const tenantAdmin: Actor = { id: 'ta', persona: 'ops', tenantId: 't1' };
const platformAdmin: Actor = { id: 'pa', persona: 'ops', tenantId: null };

function make(over: { getFile?: unknown } = {}) {
  const port = {
    listFiles: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    getFile: vi.fn().mockResolvedValue('getFile' in over ? over.getFile : { fileRecord: { tenantId: 't1' }, attachments: [] }),
    storageUsage: vi.fn().mockResolvedValue([]),
    listOrphanedFileRecords: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    getAccessLog: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    categoryUsage: vi.fn().mockResolvedValue([]),
    statsSummary: vi.fn().mockResolvedValue({ uploadsByDay: [], byCategory: [] }),
    listRejections: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
  };
  const attachments = {
    getDownloadUrl: vi.fn().mockResolvedValue('https://url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn() };
  const svc = new FileInventoryApiService(
    port as never,
    attachments as never,
    { isPlatformAdmin: (a: Actor) => a.tenantId === null, downloadUrlExpiry: { inApp: 300, shareableLink: 3600 } },
    audit as never,
  );
  return { svc, port, attachments, audit };
}

describe('FileInventoryApiService tenant scoping', () => {
  it('forces a non-platform actor to their own tenant on list', async () => {
    const { svc, port } = make();
    await svc.listFiles(tenantAdmin, { tenantId: 't2' });
    expect(port.listFiles).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
  });

  it('lets a platform admin filter by any tenant', async () => {
    const { svc, port } = make();
    await svc.listFiles(platformAdmin, { tenantId: 't9' });
    expect(port.listFiles).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't9' }));
  });

  it('getFile 404s an unknown id', async () => {
    const { svc } = make({ getFile: null });
    await expect(svc.getFile(tenantAdmin, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getFile refuses a cross-tenant file for a tenant admin', async () => {
    const { svc } = make({ getFile: { fileRecord: { tenantId: 't2' }, attachments: [] } });
    await expect(svc.getFile(tenantAdmin, 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getFile attaches a short-lived in-app URL', async () => {
    const { svc, attachments } = make();
    const res = await svc.getFile(tenantAdmin, 'f1');
    expect(res.url).toBe('https://url');
    expect(attachments.getDownloadUrl).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: tenantAdmin, purpose: 'in-app' });
  });

  it('deleteFile delegates to AttachmentService and records an audit event', async () => {
    const { svc, attachments, audit } = make();
    await svc.deleteFile(tenantAdmin, 'f1');
    expect(attachments.deleteFile).toHaveBeenCalledWith({ fileRecordId: 'f1', actor: tenantAdmin });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.deleted', entityId: 'f1' }));
  });

  it('stats forces a non-platform actor to their own tenant and forwards windowDays', async () => {
    const { svc, port } = make();
    await svc.stats(tenantAdmin, { tenantId: 't2', windowDays: 7 });
    expect(port.statsSummary).toHaveBeenCalledWith({ tenantId: 't1', windowDays: 7 });
  });

  it('stats lets a platform admin filter by any tenant', async () => {
    const { svc, port } = make();
    await svc.stats(platformAdmin, { tenantId: 't9' });
    expect(port.statsSummary).toHaveBeenCalledWith({ tenantId: 't9', windowDays: undefined });
  });

  it('listRejections forces a non-platform actor to their own tenant and forwards filters', async () => {
    const { svc, port } = make();
    await svc.listRejections(tenantAdmin, { tenantId: 't2', category: 'kyc.identity-document', reason: 'validation-failed', limit: 20 });
    expect(port.listRejections).toHaveBeenCalledWith({
      tenantId: 't1',
      category: 'kyc.identity-document',
      reason: 'validation-failed',
      limit: 20,
      cursor: undefined,
    });
  });

  it('listRejections lets a platform admin filter by any tenant', async () => {
    const { svc, port } = make();
    await svc.listRejections(platformAdmin, { tenantId: 't9' });
    expect(port.listRejections).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't9' }),
    );
  });
});
