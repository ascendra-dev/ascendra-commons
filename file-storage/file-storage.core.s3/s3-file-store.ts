import { Injectable } from '@nestjs/common';
import type { FileStore } from '../file-storage.core';

export class S3FileStoreNotImplementedError extends Error {
  constructor(op: string) {
    super(
      `S3FileStore.${op}() is not implemented. file-storage.core.s3 is a seam placeholder — ` +
        'the Model 2 blob backend has not been built. Use file-storage.core.supabase, or supply your own FileStore.',
    );
    this.name = 'S3FileStoreNotImplementedError';
  }
}

/**
 * Model 2 blob backend — **not built**. The seam is real (its own package,
 * token and module, a drop-in `FileStore`); the implementation throws.
 *
 * When built it should differ from `SupabaseFileStore` in ways that matter at
 * S3 scale, documented in this package's README:
 *   - presigned `PUT` for direct-to-bucket upload (the bytes never transit the API),
 *   - presigned `GET` for download (replaces Supabase's `createSignedUrl`),
 *   - multipart upload + a streaming `FileScanner` path for large files,
 *   - server-side encryption (SSE-KMS) per bucket/category,
 *   - `fileRef` still encodes `"{bucket}/{key}"` — the contract is unchanged.
 */
@Injectable()
export class S3FileStore implements FileStore {
  async upload(): Promise<{ fileRef: string }> {
    throw new S3FileStoreNotImplementedError('upload');
  }

  async getUrl(): Promise<string> {
    throw new S3FileStoreNotImplementedError('getUrl');
  }

  async delete(): Promise<void> {
    throw new S3FileStoreNotImplementedError('delete');
  }
}
