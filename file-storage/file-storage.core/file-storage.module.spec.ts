import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileStorageModule } from './file-storage.module';
import { AttachmentService } from './attachment.service';
import { RegistryAttachmentAuthorizer } from './attachment-authorizer';
import { MissingSignedLinkResolverError } from './signed-link-resolver.port';
import { AUTHORIZER } from '../../authorization/authorization.core';
import {
  ATTACHMENT_STORE,
  FILE_ACCESS_RECORDER,
  FILE_CATEGORY_REGISTRY,
  FILE_SCANNER,
  FILE_STORAGE_AUDIT_EMITTER,
  FILE_STORE,
  FILE_VALIDATOR,
  SIGNED_LINK_RESOLVER,
} from './tokens';

const FAKE_FILE_STORE = Symbol('FAKE_FILE_STORE');
const FAKE_ATTACHMENT_STORE = Symbol('FAKE_ATTACHMENT_STORE');
const FAKE_CATEGORY_REGISTRY = Symbol('FAKE_CATEGORY_REGISTRY');

@Module({
  providers: [
    { provide: FAKE_FILE_STORE, useValue: { upload: vi.fn(), getUrl: vi.fn(), delete: vi.fn() } },
    { provide: FAKE_ATTACHMENT_STORE, useValue: { attach: vi.fn(), getFileRecordById: vi.fn() } },
    { provide: FAKE_CATEGORY_REGISTRY, useValue: { resolve: vi.fn(), list: vi.fn() } },
    { provide: AUTHORIZER, useValue: { can: vi.fn().mockResolvedValue(true) } },
  ],
  exports: [FAKE_FILE_STORE, FAKE_ATTACHMENT_STORE, FAKE_CATEGORY_REGISTRY, AUTHORIZER],
})
class FakeInfraModule {}

const base = {
  fileStoreToken: FAKE_FILE_STORE,
  attachmentStoreToken: FAKE_ATTACHMENT_STORE,
  fileCategoryRegistryToken: FAKE_CATEGORY_REGISTRY,
  imports: [FakeInfraModule],
};

describe('FileStorageModule.forRoot — token wiring', () => {
  it('throws when a required token is missing', () => {
    // @ts-expect-error — deliberately omitting required fields
    expect(() => FileStorageModule.forRoot({})).toThrow(/requires/);
  });

  it('aliases the three required tokens and provides AttachmentService', async () => {
    const ref = await Test.createTestingModule({ imports: [FileStorageModule.forRoot(base)] }).compile();
    expect(ref.get(FILE_STORE)).toBeDefined();
    expect(ref.get(ATTACHMENT_STORE)).toBeDefined();
    expect(ref.get(FILE_CATEGORY_REGISTRY)).toBeDefined();
    expect(ref.get(AttachmentService)).toBeInstanceOf(AttachmentService);
    expect(ref.get(RegistryAttachmentAuthorizer)).toBeInstanceOf(RegistryAttachmentAuthorizer);
  });

  it('defaults the optional hooks — Noop scanner/recorder/audit, a RuleBasedFileValidator, a Missing signed-link resolver', async () => {
    const ref = await Test.createTestingModule({ imports: [FileStorageModule.forRoot(base)] }).compile();
    expect(ref.get(FILE_SCANNER)).toBeDefined();
    expect(ref.get(FILE_ACCESS_RECORDER)).toBeDefined();
    expect(ref.get(FILE_STORAGE_AUDIT_EMITTER)).toBeDefined();
    expect(ref.get(FILE_VALIDATOR)).toBeDefined();
    await expect((ref.get(SIGNED_LINK_RESOLVER) as { resolve: (t: string) => Promise<unknown> }).resolve('x')).rejects.toBeInstanceOf(
      MissingSignedLinkResolverError,
    );
  });

  it('binds a supplied scanner token over the Noop default', async () => {
    const FAKE_SCANNER = Symbol('FAKE_SCANNER');
    const scan = vi.fn().mockResolvedValue('clean');
    @Module({ providers: [{ provide: FAKE_SCANNER, useValue: { scan } }], exports: [FAKE_SCANNER] })
    class ScannerModule {}

    const ref = await Test.createTestingModule({
      imports: [FileStorageModule.forRoot({ ...base, fileScannerToken: FAKE_SCANNER, imports: [FakeInfraModule, ScannerModule] })],
    }).compile();

    await (ref.get(FILE_SCANNER) as { scan: () => Promise<unknown> }).scan();
    expect(scan).toHaveBeenCalled();
  });
});
