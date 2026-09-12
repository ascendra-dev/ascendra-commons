import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AttachmentService } from './attachment.service';
import type { Actor } from '../../authorization/authorization.core';
import type { AttachmentStore } from './attachment-store.port';
import type { FileCategoryRegistry, ResolvedFileCategory } from './file-category';
import type { FileScanner, ScanVerdict } from './file-scanner.port';
import type { FileStore } from './file-store.port';
import { RuleBasedFileValidator } from './file-validator.port';
import { resolveFileStorageOptions } from './file-storage.options';
import type { FileRecord } from './file-record.interface';

const issuer: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
const platformAdmin: Actor = { id: 'admin', persona: 'ops', tenantId: null };

const category: ResolvedFileCategory = {
  key: 'kyc.identity-document',
  label: 'ID',
  bucket: 'kyc',
  allowedContentTypes: ['application/pdf'],
  maxSizeBytes: 8_000,
  minSizeBytes: 1,
  onUnscannable: 'reject',
  signedLinkExpirySeconds: 120,
  retention: 'indefinite',
  active: true,
};

function fileRecord(over: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 'f1',
    tenantId: 't1',
    fileRef: 'kyc/t1/f1.pdf',
    category: 'kyc.identity-document',
    contentType: 'application/pdf',
    sizeBytes: 100,
    contentHash: 'abc',
    uploadedBy: 'u1',
    createdAt: new Date(),
    ...over,
  };
}

function makeService(over: {
  store?: Partial<AttachmentStore>;
  fileStore?: Partial<FileStore>;
  registry?: Partial<FileCategoryRegistry>;
  scanVerdict?: ScanVerdict;
  signedLink?: { fileRecordId: string } | null;
  accessRecord?: () => Promise<void>;
} = {}) {
  const fileStore: FileStore = {
    upload: vi.fn().mockResolvedValue({ fileRef: 'kyc/t1/f1.pdf' }),
    getUrl: vi.fn().mockResolvedValue('https://signed/url'),
    delete: vi.fn().mockResolvedValue(undefined),
    ...over.fileStore,
  };
  const store: AttachmentStore = {
    attach: vi.fn().mockResolvedValue({ fileRecord: fileRecord(), attachment: { id: 'a1' } }),
    link: vi.fn().mockResolvedValue({ id: 'a2' }),
    getFileRecordById: vi.fn().mockResolvedValue(fileRecord()),
    getAttachmentById: vi.fn().mockResolvedValue({ id: 'a1', fileRecordId: 'f1' }),
    findByEntity: vi.fn().mockResolvedValue([]),
    detach: vi.fn().mockResolvedValue(undefined),
    deleteFileCascade: vi.fn().mockResolvedValue(fileRecord()),
    ...over.store,
  };
  const registry: FileCategoryRegistry = {
    resolve: vi.fn().mockResolvedValue(category),
    list: vi.fn().mockResolvedValue([category]),
    ...over.registry,
  };
  const scanner: FileScanner = { scan: vi.fn().mockResolvedValue(over.scanVerdict ?? 'clean') };
  const accessRecorder = { record: vi.fn(over.accessRecord ?? (() => Promise.resolve())) };
  const audit = { emit: vi.fn().mockResolvedValue(undefined) };
  const signedLinks = {
    resolve: vi.fn().mockResolvedValue('signedLink' in over ? over.signedLink : { fileRecordId: 'f1' }),
  };

  const service = new AttachmentService(
    fileStore,
    store,
    registry,
    new RuleBasedFileValidator({ absoluteMaxSizeBytes: 1_000_000 }),
    scanner,
    accessRecorder,
    signedLinks,
    audit,
    resolveFileStorageOptions({}),
  );
  return { service, fileStore, store, registry, scanner, accessRecorder, audit, signedLinks };
}

const goodUpload = {
  file: { data: Buffer.from('%PDF-1.4 ...'), contentType: 'application/pdf', filename: 'id.pdf', sizeBytes: 12 },
  category: 'kyc.identity-document',
  attachedTo: { type: 'issuer', id: 'iss-1' },
  actor: issuer,
};

describe('AttachmentService.attach', () => {
  it('validates, scans, uploads and persists on the happy path', async () => {
    const { service, fileStore, store, audit } = makeService();
    const res = await service.attach(goodUpload);

    expect(fileStore.upload).toHaveBeenCalledWith(
      goodUpload.file.data,
      expect.objectContaining({ bucket: 'kyc', category: 'kyc.identity-document', tenantId: 't1' }),
    );
    expect(store.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        fileRecord: expect.objectContaining({ tenantId: 't1', uploadedBy: 'u1', contentHash: expect.any(String) }),
      }),
    );
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.attached' }));
    expect(res.attachment.id).toBe('a1');
  });

  it('rejects an actor with no tenant', async () => {
    const { service } = makeService();
    await expect(service.attach({ ...goodUpload, actor: platformAdmin })).rejects.toBeInstanceOf(Error);
  });

  it('rejects an unavailable category with Forbidden and never uploads', async () => {
    const { service, fileStore } = makeService({ registry: { resolve: vi.fn().mockResolvedValue(null) } });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(ForbiddenException);
    expect(fileStore.upload).not.toHaveBeenCalled();
  });

  it('rejects an inactive category', async () => {
    const { service } = makeService({ registry: { resolve: vi.fn().mockResolvedValue({ ...category, active: false }) } });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maps a category-rule violation to 422 and never uploads', async () => {
    const { service, fileStore } = makeService();
    await expect(
      service.attach({ ...goodUpload, file: { ...goodUpload.file, contentType: 'image/png', filename: 'id.png' } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(fileStore.upload).not.toHaveBeenCalled();
  });

  it('rejects an infected file with 422', async () => {
    const { service } = makeService({ scanVerdict: 'infected' });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an unscannable file when the category policy is reject', async () => {
    const { service } = makeService({ scanVerdict: 'unscannable' });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('allows an unscannable file when the category policy is allow', async () => {
    const { service } = makeService({
      scanVerdict: 'unscannable',
      registry: { resolve: vi.fn().mockResolvedValue({ ...category, onUnscannable: 'allow' }) },
    });
    await expect(service.attach(goodUpload)).resolves.toBeDefined();
  });

  it('best-effort deletes the blob when persistence fails, then rethrows', async () => {
    const { service, fileStore } = makeService({
      store: { attach: vi.fn().mockRejectedValue(new Error('db down')) },
    });
    await expect(service.attach(goodUpload)).rejects.toThrow('db down');
    expect(fileStore.delete).toHaveBeenCalledWith('kyc/t1/f1.pdf');
  });
});

describe('AttachmentService downloads + tenant isolation', () => {
  it('getDownloadUrl hands back a URL for a same-tenant actor and records the access', async () => {
    const { service, fileStore, accessRecorder } = makeService();
    const url = await service.getDownloadUrl({ fileRecordId: 'f1', actor: issuer, purpose: 'in-app' });
    expect(url).toBe('https://signed/url');
    expect(fileStore.getUrl).toHaveBeenCalledWith('kyc/t1/f1.pdf', { expirySeconds: 300 });
    await vi.waitFor(() => expect(accessRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ via: 'actor', actorId: 'u1' })));
  });

  it('getDownloadUrl refuses a cross-tenant actor', async () => {
    const { service } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ tenantId: 't2' })) } });
    await expect(service.getDownloadUrl({ fileRecordId: 'f1', actor: issuer, purpose: 'in-app' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getDownloadUrl lets a platform admin cross tenants', async () => {
    const { service } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ tenantId: 't2' })) } });
    await expect(service.getDownloadUrl({ fileRecordId: 'f1', actor: platformAdmin, purpose: 'in-app' })).resolves.toBe('https://signed/url');
  });

  it('shareable-link expiry comes from the category when set', async () => {
    const { service, fileStore } = makeService();
    await service.getDownloadUrl({ fileRecordId: 'f1', actor: issuer, purpose: 'shareable-link' });
    expect(fileStore.getUrl).toHaveBeenCalledWith('kyc/t1/f1.pdf', { expirySeconds: 120 });
  });

  it('getDownloadUrlByToken resolves the token, skips the tenant check, records via signed-link', async () => {
    const { service, accessRecorder } = makeService();
    const url = await service.getDownloadUrlByToken({ token: 'tok' });
    expect(url).toBe('https://signed/url');
    await vi.waitFor(() => expect(accessRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ via: 'signed-link', actorId: null })));
  });

  it('getDownloadUrlByToken rejects an invalid token', async () => {
    const { service } = makeService({ signedLink: null });
    await expect(service.getDownloadUrlByToken({ token: 'bad' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getDownloadUrl 404s an unknown file', async () => {
    const { service } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(null) } });
    await expect(service.getDownloadUrl({ fileRecordId: 'nope', actor: issuer, purpose: 'in-app' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AttachmentService.detach / deleteFile', () => {
  it('detach removes the association, keeps the file', async () => {
    const { service, store, fileStore } = makeService();
    await service.detach({ attachmentId: 'a1', actor: issuer });
    expect(store.detach).toHaveBeenCalledWith('a1');
    expect(fileStore.delete).not.toHaveBeenCalled();
  });

  it('deleteFile cascades the metadata then deletes the blob', async () => {
    const { service, store, fileStore } = makeService();
    await service.deleteFile({ fileRecordId: 'f1', actor: issuer });
    expect(store.deleteFileCascade).toHaveBeenCalledWith('f1');
    expect(fileStore.delete).toHaveBeenCalledWith('kyc/t1/f1.pdf');
  });

  it('deleteFile refuses a cross-tenant actor', async () => {
    const { service } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ tenantId: 't2' })) } });
    await expect(service.deleteFile({ fileRecordId: 'f1', actor: issuer })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
