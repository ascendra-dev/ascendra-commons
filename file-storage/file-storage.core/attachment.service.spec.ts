import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, GoneException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AttachmentService, cleanFilename, retainUntil } from './attachment.service';
import type { Actor } from '../../authorization/authorization.core';
import type { AttachmentStore } from './attachment-store.port';
import type { FileCategoryRegistry, ResolvedFileCategory } from './file-category';
import type { FileScanner, ScanVerdict } from './file-scanner.port';
import type { FileStore } from './file-store.port';
import { RuleBasedFileValidator } from './file-validator.port';
import { DirectUploadUnsupportedError, type DirectUploadFileStore, type PendingUploadStore } from './direct-upload.port';
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
    filename: 'id.pdf',
    scanVerdict: 'clean',
    retainUntil: null,
    legalHold: null,
    createdAt: new Date(),
    ...over,
  };
}

function makeService(over: {
  store?: Partial<AttachmentStore>;
  fileStore?: Partial<DirectUploadFileStore>;
  registry?: Partial<FileCategoryRegistry>;
  scanVerdict?: ScanVerdict;
  signedLink?: { fileRecordId: string } | null;
  accessRecord?: () => Promise<void>;
  rejectionRecord?: () => Promise<void>;
  quota?: { tenantId: string; maxBytes: number; updatedAt: Date; updatedBy: string };
  used?: number;
  pendingUpload?: Record<string, unknown> | null;
  pendingDeleted?: boolean;
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
    setLegalHold: vi.fn(async (_id: string, hold) => fileRecord({ legalHold: hold })),
    ...over.store,
  };
  const registry: FileCategoryRegistry = {
    resolve: vi.fn().mockResolvedValue(category),
    list: vi.fn().mockResolvedValue([category]),
    ...over.registry,
  };
  const scanner: FileScanner = { scan: vi.fn().mockResolvedValue(over.scanVerdict ?? 'clean') };
  const accessRecorder = { record: vi.fn(over.accessRecord ?? (() => Promise.resolve())) };
  const rejectionRecorder = { record: vi.fn(over.rejectionRecord ?? (() => Promise.resolve())) };
  const audit = { emit: vi.fn().mockResolvedValue(undefined) };
  const quotas = {
    getQuota: vi.fn().mockResolvedValue(over.quota ?? null),
    usage: vi.fn().mockResolvedValue(over.used ?? 0),
    setQuota: vi.fn(),
    clearQuota: vi.fn(),
    listQuotas: vi.fn(),
  };
  const pending = {
    create: vi.fn(async (u: Record<string, unknown>) => ({ ...u, id: 'up1', createdAt: new Date() })),
    get: vi.fn().mockResolvedValue(over.pendingUpload ?? null),
    delete: vi.fn().mockResolvedValue(over.pendingDeleted ?? true),
    findExpired: vi.fn().mockResolvedValue([]),
  } as unknown as PendingUploadStore & { [K in keyof PendingUploadStore]: ReturnType<typeof vi.fn> };
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
    rejectionRecorder,
    signedLinks,
    audit,
    resolveFileStorageOptions({}),
    quotas,
    pending,
  );
  return { service, fileStore, store, registry, scanner, accessRecorder, rejectionRecorder, audit, signedLinks, quotas, pending };
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
        fileRecord: expect.objectContaining({
          tenantId: 't1',
          uploadedBy: 'u1',
          contentHash: expect.any(String),
          filename: 'id.pdf',
          scanVerdict: 'clean',
          retainUntil: null,
        }),
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

  it('never records a rejection on the happy path', async () => {
    const { service, rejectionRecorder } = makeService();
    await service.attach(goodUpload);
    expect(rejectionRecorder.record).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.attach — rejection recording', () => {
  it('records a category-unavailable rejection and still throws Forbidden', async () => {
    const { service, rejectionRecorder } = makeService({ registry: { resolve: vi.fn().mockResolvedValue(null) } });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(ForbiddenException);
    await vi.waitFor(() =>
      expect(rejectionRecorder.record).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', actorId: 'u1', reason: 'category-unavailable' }),
      ),
    );
  });

  it('records a validation-failed rejection and still throws 422', async () => {
    const { service, rejectionRecorder } = makeService();
    await expect(
      service.attach({ ...goodUpload, file: { ...goodUpload.file, contentType: 'image/png', filename: 'id.png' } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await vi.waitFor(() =>
      expect(rejectionRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'validation-failed' })),
    );
  });

  it('records a scan-rejected rejection for an infected file', async () => {
    const { service, rejectionRecorder } = makeService({ scanVerdict: 'infected' });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await vi.waitFor(() =>
      expect(rejectionRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'scan-rejected' })),
    );
  });

  it('records a scan-rejected rejection for an unscannable file the category rejects', async () => {
    const { service, rejectionRecorder } = makeService({ scanVerdict: 'unscannable' });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await vi.waitFor(() =>
      expect(rejectionRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'scan-rejected' })),
    );
  });

  it('a throwing recorder never surfaces — the original rejection is still thrown', async () => {
    const { service } = makeService({
      registry: { resolve: vi.fn().mockResolvedValue(null) },
      rejectionRecord: () => Promise.reject(new Error('recorder down')),
    });
    await expect(service.attach(goodUpload)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AttachmentService downloads + tenant isolation', () => {
  it('getDownloadUrl hands back a URL for a same-tenant actor and records the access', async () => {
    const { service, fileStore, accessRecorder } = makeService();
    const url = await service.getDownloadUrl({ fileRecordId: 'f1', actor: issuer, purpose: 'in-app' });
    expect(url).toBe('https://signed/url');
    expect(fileStore.getUrl).toHaveBeenCalledWith('kyc/t1/f1.pdf', { expirySeconds: 300, filename: 'id.pdf', contentType: 'application/pdf' });
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
    expect(fileStore.getUrl).toHaveBeenCalledWith('kyc/t1/f1.pdf', expect.objectContaining({ expirySeconds: 120 }));
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

describe('AttachmentService.attach — what is recorded', () => {
  it('stores the scan verdict of an unscannable file the category allows', async () => {
    const { service, store } = makeService({
      scanVerdict: 'unscannable',
      registry: { resolve: vi.fn().mockResolvedValue({ ...category, onUnscannable: 'allow' }) },
    });
    await service.attach(goodUpload);
    expect(store.attach).toHaveBeenCalledWith(expect.objectContaining({ fileRecord: expect.objectContaining({ scanVerdict: 'unscannable' }) }));
  });

  it("fixes retainUntil from the category's keepForDays", async () => {
    const { service, store } = makeService({
      registry: { resolve: vi.fn().mockResolvedValue({ ...category, retention: { keepForDays: 10 } }) },
    });
    const before = Date.now();
    await service.attach(goodUpload);
    const until = (store.attach as ReturnType<typeof vi.fn>).mock.calls[0][0].fileRecord.retainUntil as Date;
    expect(until.getTime() - before).toBeGreaterThanOrEqual(10 * 86_400_000);
    expect(until.getTime() - before).toBeLessThan(10 * 86_400_000 + 5_000);
  });
});

describe('cleanFilename', () => {
  it.each([
    ['C:\\fakepath\\scan.pdf', 'scan.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['  bad\u0000name\u001f.png ', 'badname.png'],
    ['', null],
    ['/', null],
  ])('%j → %j', (input, out) => expect(cleanFilename(input)).toBe(out));

  it('cuts a long name to 255, keeping the extension', () => {
    const name = cleanFilename(`${'a'.repeat(400)}.pdf`)!;
    expect(name).toHaveLength(255);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('retainUntil', () => {
  it('is null for indefinite and from + N days otherwise', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(retainUntil('indefinite', from)).toBeNull();
    expect(retainUntil({ keepForDays: 30 }, from)?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('AttachmentService.link', () => {
  it('links under a category that resolves for the file tenant', async () => {
    const { service, store, registry } = makeService();
    await service.link({ fileRecordId: 'f1', attachedTo: { type: 'invoice', id: 'i1' }, category: 'kyc.identity-document', actor: issuer });
    expect(registry.resolve).toHaveBeenCalledWith('t1', 'kyc.identity-document');
    expect(store.link).toHaveBeenCalled();
  });

  it('refuses an unknown or inactive category — never free text', async () => {
    const { service, store } = makeService({ registry: { resolve: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.link({ fileRecordId: 'f1', attachedTo: { type: 'invoice', id: 'i1' }, category: 'anything', actor: issuer }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.link).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.listForEntity', () => {
  it("scopes a tenant actor to their own tenant's files", async () => {
    const { service, store } = makeService();
    await service.listForEntity({ attachedTo: { type: 'invoice', id: 'i1' }, actor: issuer });
    expect(store.findByEntity).toHaveBeenCalledWith('invoice', 'i1', { tenantId: 't1' });
  });

  it('a platform admin sees every tenant', async () => {
    const { service, store } = makeService();
    await service.listForEntity({ attachedTo: { type: 'invoice', id: 'i1' }, actor: platformAdmin });
    expect(store.findByEntity).toHaveBeenCalledWith('invoice', 'i1', { tenantId: undefined });
  });
});

describe('AttachmentService.deleteFile — retention and legal hold', () => {
  const held = { heldAt: new Date(), heldBy: 'counsel', reason: 'dispute #12' };
  const future = new Date(Date.now() + 86_400_000);

  it('refuses a held file — even for a platform admin — and deletes nothing', async () => {
    const { service, store } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ legalHold: held })) } });
    await expect(service.deleteFile({ fileRecordId: 'f1', actor: platformAdmin })).rejects.toBeInstanceOf(ConflictException);
    expect(store.deleteFileCascade).not.toHaveBeenCalled();
  });

  it('refuses a tenant actor before retainUntil', async () => {
    const { service, store } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ retainUntil: future })) } });
    await expect(service.deleteFile({ fileRecordId: 'f1', actor: issuer })).rejects.toThrow(/must be kept until/);
    expect(store.deleteFileCascade).not.toHaveBeenCalled();
  });

  it('lets a platform admin delete early and marks the audit event', async () => {
    const record = fileRecord({ retainUntil: future });
    const { service, audit } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(record) } });
    await service.deleteFile({ fileRecordId: 'f1', actor: platformAdmin });
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.deleted', overrodeRetention: true, before: record }));
  });

  it("carries the deleter's reason on the audit event", async () => {
    const { service, audit } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ retainUntil: future })) } });
    await service.deleteFile({ fileRecordId: 'f1', actor: platformAdmin, reason: '  GDPR erasure #88 ' });
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.deleted', overrodeRetention: true, reason: 'GDPR erasure #88' }));
  });

  it('a file past its retainUntil deletes normally', async () => {
    const { service, audit } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ retainUntil: new Date(Date.now() - 1000) })) } });
    await service.deleteFile({ fileRecordId: 'f1', actor: issuer });
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.deleted', overrodeRetention: false }));
  });
});

describe('AttachmentService legal hold', () => {
  it('places a hold with who and why, and audits it', async () => {
    const { service, store, audit } = makeService();
    const res = await service.placeLegalHold({ fileRecordId: 'f1', actor: issuer, reason: '  dispute #12 ' });
    expect(store.setLegalHold).toHaveBeenCalledWith('f1', expect.objectContaining({ heldBy: 'u1', reason: 'dispute #12' }));
    expect(res.legalHold?.reason).toBe('dispute #12');
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.hold_placed', reason: 'dispute #12' }));
  });

  it('needs a reason, and 409s a file already held', async () => {
    const { service } = makeService();
    await expect(service.placeLegalHold({ fileRecordId: 'f1', actor: issuer, reason: ' ' })).rejects.toThrow(/needs a reason/);
    const { service: heldService } = makeService({
      store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ legalHold: { heldAt: new Date(), heldBy: 'x', reason: 'y' } })) },
    });
    await expect(heldService.placeLegalHold({ fileRecordId: 'f1', actor: issuer, reason: 'z' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('releases a hold and audits what it was; 409 when not held', async () => {
    const hold = { heldAt: new Date(), heldBy: 'counsel', reason: 'dispute #12' };
    const { service, store, audit } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ legalHold: hold })) } });
    await service.releaseLegalHold({ fileRecordId: 'f1', actor: issuer });
    expect(store.setLegalHold).toHaveBeenCalledWith('f1', null);
    expect(audit.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file.hold_released', before: hold }));
    await expect(makeService().service.releaseLegalHold({ fileRecordId: 'f1', actor: issuer })).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses another tenant's file", async () => {
    const { service } = makeService({ store: { getFileRecordById: vi.fn().mockResolvedValue(fileRecord({ tenantId: 't2' })) } });
    await expect(service.placeLegalHold({ fileRecordId: 'f1', actor: issuer, reason: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AttachmentService.attach — storage limit', () => {
  const quota = { tenantId: 't1', maxBytes: 100, updatedAt: new Date(), updatedBy: 'pa' };

  it('refuses an upload that would pass the limit, records it, and never stores a byte', async () => {
    const { service, fileStore, rejectionRecorder, scanner } = makeService({ quota, used: 95 });
    await expect(service.attach(goodUpload)).rejects.toThrow(/storage is full — 95 of 100 bytes used/);
    expect(fileStore.upload).not.toHaveBeenCalled();
    expect(scanner.scan).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(rejectionRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'quota-exceeded' })));
  });

  it('lets an upload that fits through', async () => {
    const { service, fileStore } = makeService({ quota, used: 80 });
    await service.attach(goodUpload);
    expect(fileStore.upload).toHaveBeenCalled();
  });

  it('no limit → usage is never read', async () => {
    const { service, quotas } = makeService();
    await service.attach(goodUpload);
    expect(quotas.usage).not.toHaveBeenCalled();
  });
});

describe('AttachmentService direct uploads', () => {
  const pdf = Buffer.from('%PDF-1.4 hello');
  const direct = (over: { size?: number; data?: Buffer; exists?: boolean } = {}) => ({
    reserveRef: vi.fn(({ bucket, tenantId }: { bucket: string; tenantId: string }) => `${bucket}/${tenantId}/new`),
    createUploadUrl: vi.fn().mockResolvedValue({ url: 'https://up', method: 'PUT', headers: { 'Content-Type': 'application/pdf' } }),
    stat: vi.fn().mockResolvedValue(over.exists === false ? null : { sizeBytes: over.size ?? pdf.length }),
    read: vi.fn().mockResolvedValue(over.data ?? pdf),
  });
  const begun = (over: Record<string, unknown> = {}) => ({
    id: 'up1', tenantId: 't1', actorId: 'u1', category: 'kyc.identity-document', attachedToType: 'issuer', attachedToId: 'iss-1',
    filename: 'id.pdf', contentType: 'application/pdf', sizeBytes: pdf.length, fileRef: 'kyc/t1/new',
    expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), ...over,
  });
  const meta = { contentType: 'application/pdf', filename: 'id.pdf', sizeBytes: pdf.length };

  it('begin checks the metadata, reserves a key, records the upload and hands out a URL with its headers', async () => {
    const { service, pending } = makeService({ fileStore: direct() });
    const res = await service.beginUpload({ file: meta, category: 'kyc.identity-document', attachedTo: { type: 'issuer', id: 'iss-1' }, actor: issuer });
    expect(pending.create).toHaveBeenCalledWith(expect.objectContaining({ fileRef: 'kyc/t1/new', sizeBytes: pdf.length, actorId: 'u1' }));
    expect(res).toMatchObject({ uploadId: 'up1', url: 'https://up', method: 'PUT', headers: { 'Content-Type': 'application/pdf' } });
  });

  it('begin refuses what the metadata already rules out — no URL', async () => {
    const fs = direct();
    const { service } = makeService({ fileStore: fs });
    await expect(service.beginUpload({ file: { ...meta, contentType: 'image/png' }, category: 'kyc.identity-document', attachedTo: { type: 'i', id: '1' }, actor: issuer }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(fs.createUploadUrl).not.toHaveBeenCalled();
  });

  it('a store that cannot take direct uploads says so', async () => {
    await expect(makeService().service.beginUpload({ file: meta, category: 'kyc.identity-document', attachedTo: { type: 'i', id: '1' }, actor: issuer }))
      .rejects.toBeInstanceOf(DirectUploadUnsupportedError);
  });

  it('complete reads the bytes back, scans, persists with the hash, and claims the upload once', async () => {
    const fs = direct();
    const { service, store, scanner, pending } = makeService({ fileStore: fs, pendingUpload: begun() });
    await service.completeUpload({ uploadId: 'up1', actor: issuer });
    expect(fs.read).toHaveBeenCalledWith('kyc/t1/new');
    expect(scanner.scan).toHaveBeenCalledWith(pdf, expect.anything());
    expect(pending.delete).toHaveBeenCalledWith('up1');
    expect(store.attach).toHaveBeenCalledWith(expect.objectContaining({
      fileRecord: expect.objectContaining({ fileRef: 'kyc/t1/new', contentHash: expect.stringMatching(/^[0-9a-f]{64}$/), filename: 'id.pdf' }),
      attachment: expect.objectContaining({ attachedToType: 'issuer', attachedToId: 'iss-1' }),
    }));
  });

  it("complete: someone else's upload is a 404; an expired one is a 410; nothing uploaded is a 409", async () => {
    await expect(makeService({ fileStore: direct(), pendingUpload: begun({ actorId: 'other' }) }).service.completeUpload({ uploadId: 'up1', actor: issuer }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(makeService({ fileStore: direct(), pendingUpload: begun({ expiresAt: new Date(0) }) }).service.completeUpload({ uploadId: 'up1', actor: issuer }))
      .rejects.toBeInstanceOf(GoneException);
    await expect(makeService({ fileStore: direct({ exists: false }), pendingUpload: begun() }).service.completeUpload({ uploadId: 'up1', actor: issuer }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('complete: a size that differs, or bytes that are not the declared type, deletes the object and records the refusal', async () => {
    const { service, rejectionRecorder, store, fileStore } = makeService({ fileStore: direct({ size: 999 }), pendingUpload: begun() });
    await expect(service.completeUpload({ uploadId: 'up1', actor: issuer })).rejects.toThrow(/999 bytes; 14 were declared/);
    expect(fileStore.delete).toHaveBeenCalledWith('kyc/t1/new');
    expect(store.attach).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(rejectionRecorder.record).toHaveBeenCalledWith(expect.objectContaining({ reason: 'validation-failed' })));

    const html = Buffer.from('<html><body>hi!!</body></html>').subarray(0, pdf.length);
    const second = makeService({ fileStore: direct({ data: html }), pendingUpload: begun() });
    await expect(second.service.completeUpload({ uploadId: 'up1', actor: issuer })).rejects.toThrow(/doesn't start the way one does/);
    expect(second.fileStore.delete).toHaveBeenCalledWith('kyc/t1/new');
  });

  it('complete: a second complete for the same upload loses the claim — 404, no second record', async () => {
    const { service, store } = makeService({ fileStore: direct(), pendingUpload: begun(), pendingDeleted: false });
    await expect(service.completeUpload({ uploadId: 'up1', actor: issuer })).rejects.toBeInstanceOf(NotFoundException);
    expect(store.attach).not.toHaveBeenCalled();
  });
});
