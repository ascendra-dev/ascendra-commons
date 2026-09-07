import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseFileStore } from './supabase-file-store';
import { FileStoreError, type FileStoreConfig } from '../file-storage.core';

function fakeSupabase(
  overrides: {
    upload?: ReturnType<typeof vi.fn>;
    createSignedUrl?: ReturnType<typeof vi.fn>;
    remove?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const from = vi.fn(() => ({
    upload: overrides.upload ?? vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl:
      overrides.createSignedUrl ??
      vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
    remove: overrides.remove ?? vi.fn().mockResolvedValue({ error: null }),
  }));
  const fake = { storage: { from } };
  return { fake, asClient: fake as unknown as SupabaseClient };
}

const config: FileStoreConfig = {
  buildObjectKey: (meta) => `${meta.category}-${meta.filename}`,
};

describe('SupabaseFileStore', () => {
  describe('upload', () => {
    it('uses the caller-supplied bucket and buildObjectKey, never the raw client filename as the path', async () => {
      const upload = vi.fn().mockResolvedValue({ error: null });
      const { fake, asClient } = fakeSupabase({ upload });
      const store = new SupabaseFileStore(asClient, config);

      const result = await store.upload(Buffer.from('data'), {
        contentType: 'application/pdf',
        filename: '../../etc/passwd', // hostile — must never become the storage path verbatim without going through buildObjectKey
        category: 'kyc-document',
        tenantId: 't1',
        bucket: 'kyc-documents',
      });

      expect(fake.storage.from).toHaveBeenCalledWith('kyc-documents');
      expect(upload).toHaveBeenCalledWith('kyc-document-../../etc/passwd', expect.any(Buffer), {
        contentType: 'application/pdf',
      });
      expect(result.fileRef).toBe('kyc-documents/kyc-document-../../etc/passwd');
    });

    it('encodes the bucket into fileRef so getUrl/delete never re-derive it', async () => {
      const { asClient } = fakeSupabase();
      const store = new SupabaseFileStore(asClient, { buildObjectKey: (m) => m.filename });

      const result = await store.upload(Buffer.from('x'), {
        contentType: 'application/pdf',
        filename: 'doc.pdf',
        category: 'kyc-document',
        tenantId: null,
        bucket: 'kyc-documents',
      });

      expect(result.fileRef).toBe('kyc-documents/doc.pdf');
    });

    it('throws FileStoreError, not the raw provider error, on failure', async () => {
      const upload = vi.fn().mockResolvedValue({ error: { message: 'bucket not found' } });
      const { asClient } = fakeSupabase({ upload });
      const store = new SupabaseFileStore(asClient, config);

      await expect(
        store.upload(Buffer.from('x'), {
          contentType: 'text/plain',
          filename: 'a.txt',
          category: 'c',
          tenantId: null,
          bucket: 'attachments',
        }),
      ).rejects.toThrow(FileStoreError);
    });
  });

  describe('getUrl', () => {
    it('splits fileRef back into bucket and object key', async () => {
      const createSignedUrl = vi
        .fn()
        .mockResolvedValue({ data: { signedUrl: 'https://signed.example/y' }, error: null });
      const { fake, asClient } = fakeSupabase({ createSignedUrl });
      const store = new SupabaseFileStore(asClient, config);

      const url = await store.getUrl('attachments/some/nested/key.pdf');

      expect(fake.storage.from).toHaveBeenCalledWith('attachments');
      expect(createSignedUrl).toHaveBeenCalledWith('some/nested/key.pdf', 300);
      expect(url).toBe('https://signed.example/y');
    });

    it('respects a caller-supplied expiry instead of the 300s default', async () => {
      const createSignedUrl = vi
        .fn()
        .mockResolvedValue({ data: { signedUrl: 'https://signed.example/z' }, error: null });
      const { asClient } = fakeSupabase({ createSignedUrl });
      const store = new SupabaseFileStore(asClient, config);

      await store.getUrl('attachments/key.pdf', { expirySeconds: 86400 });

      expect(createSignedUrl).toHaveBeenCalledWith('key.pdf', 86400);
    });

    it('throws FileStoreError if the provider returns no data alongside no error', async () => {
      const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: null });
      const { asClient } = fakeSupabase({ createSignedUrl });
      const store = new SupabaseFileStore(asClient, config);

      await expect(store.getUrl('attachments/key.pdf')).rejects.toThrow(FileStoreError);
    });
  });

  describe('delete', () => {
    it('splits fileRef and removes from the correct bucket', async () => {
      const remove = vi.fn().mockResolvedValue({ error: null });
      const { fake, asClient } = fakeSupabase({ remove });
      const store = new SupabaseFileStore(asClient, config);

      await store.delete('attachments/key.pdf');

      expect(fake.storage.from).toHaveBeenCalledWith('attachments');
      expect(remove).toHaveBeenCalledWith(['key.pdf']);
    });

    it('throws FileStoreError on failure', async () => {
      const remove = vi.fn().mockResolvedValue({ error: { message: 'not found' } });
      const { asClient } = fakeSupabase({ remove });
      const store = new SupabaseFileStore(asClient, config);

      await expect(store.delete('attachments/key.pdf')).rejects.toThrow(FileStoreError);
    });
  });
});
