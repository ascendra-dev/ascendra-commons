import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileStorageModule } from './file-storage.module';
import { FILE_STORE, ATTACHMENT_STORE } from './tokens';
import { FileStore } from './file-store.interface';
import { AttachmentStore } from './attachment-store';
import { RegistryAttachmentAuthorizer } from './attachment-authorizer';
import { AuthorizationModule, Actor } from '../authorization';

const SUPABASE_CLIENT_IMPL = Symbol('SUPABASE_CLIENT_IMPL');
const ATTACHMENT_STORE_IMPL = Symbol('ATTACHMENT_STORE_IMPL');

const fakeSupabaseClient = {
  storage: {
    from: () => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
};

const fakeAttachmentStore: AttachmentStore = {
  attach: vi.fn(),
  findByEntity: vi.fn().mockResolvedValue([]),
};

/** Stands in for the consumer's own db/Supabase-client-providing module(s). */
@Module({
  providers: [
    { provide: SUPABASE_CLIENT_IMPL, useValue: fakeSupabaseClient },
    { provide: ATTACHMENT_STORE_IMPL, useValue: fakeAttachmentStore },
  ],
  exports: [SUPABASE_CLIENT_IMPL, ATTACHMENT_STORE_IMPL],
})
class FakeInfraModule {}

// The consumer's own already-configured AuthorizationModule — constructed once, the same
// dynamic module object reused across imports arrays, the safe way to share a
// configured dynamic module between two importing modules in the same graph.
const configuredAuthorizationModule = AuthorizationModule.forRoot({
  personaActions: { issuer: ['attachment.upload', 'attachment.view'], payer: [] },
});

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [
      configuredAuthorizationModule,
      FileStorageModule.forRoot({
        supabaseClientToken: SUPABASE_CLIENT_IMPL,
        attachmentStoreToken: ATTACHMENT_STORE_IMPL,
        fileStoreConfig: {
          bucketForCategory: () => 'attachments',
          buildObjectKey: (meta) => meta.filename,
        },
        entityAccessCheckers: {
          invoice: { canAccess: vi.fn().mockResolvedValue(true) },
        },
        imports: [FakeInfraModule, configuredAuthorizationModule],
      }),
    ],
  }).compile();
}

describe('FileStorageModule.forRoot — real DI wiring', () => {
  it('resolves FILE_STORE to a working SupabaseFileStore aliased to the consumer\'s client', async () => {
    const moduleRef = await buildTestModule();
    const fileStore = moduleRef.get<FileStore>(FILE_STORE);

    const result = await fileStore.upload(Buffer.from('x'), {
      contentType: 'application/pdf',
      filename: 'doc.pdf',
      category: 'kyc-document',
      tenantId: 't1',
    });

    expect(result.fileRef).toBe('attachments/doc.pdf');
  });

  it('resolves ATTACHMENT_STORE to the consumer\'s own aliased implementation', async () => {
    const moduleRef = await buildTestModule();
    const attachmentStore = moduleRef.get<AttachmentStore>(ATTACHMENT_STORE);

    expect(attachmentStore).toBe(fakeAttachmentStore);
  });

  it('RegistryAttachmentAuthorizer resolves AUTHORIZER from the consumer\'s separately-configured AuthorizationModule', async () => {
    const moduleRef = await buildTestModule();
    const authz = moduleRef.get(RegistryAttachmentAuthorizer);

    const issuer: Actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const payer: Actor = { id: 'u2', persona: 'payer', tenantId: null };

    // Only reachable if AUTHORIZER really resolved to the real StaticRoleMapAuthorizer
    // wired by AuthorizationModule.forRoot() above — a missing imports entry would have
    // thrown "Nest can't resolve dependencies" at compile() instead.
    await expect(authz.assertCanAttach(issuer, 'invoice', 'inv-1')).resolves.toBeUndefined();
    await expect(authz.assertCanAttach(payer, 'invoice', 'inv-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
