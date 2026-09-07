import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FileStoreError, type FileStore, type FileStoreConfig } from '../file-storage.core';
import { FILE_STORE_CONFIG } from '../file-storage.core';
import { SUPABASE_CLIENT } from './tokens';

/**
 * `fileRef` encodes the bucket alongside the object key (`"{bucket}/{objectKey}"`)
 * so `getUrl()`/`delete()` never have to re-derive the bucket — they only ever
 * see the opaque `fileRef` a `FileRecord` stored. `fileRef`'s only real
 * contract is "opaque to everyone except this implementation," so this stays
 * deliberately trivial.
 */
function splitFileRef(fileRef: string): [bucket: string, objectKey: string] {
  const [bucket, ...rest] = fileRef.split('/');
  return [bucket, rest.join('/')];
}

@Injectable()
export class SupabaseFileStore implements FileStore {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(FILE_STORE_CONFIG) private readonly config: FileStoreConfig,
  ) {}

  async upload(
    file: Buffer,
    meta: { contentType: string; filename: string; category: string; tenantId: string | null; bucket: string },
  ) {
    // never trust the client filename as the actual storage path — buildObjectKey decides the real one
    const objectKey = this.config.buildObjectKey({
      tenantId: meta.tenantId,
      category: meta.category,
      filename: meta.filename,
    });
    const { error } = await this.supabase.storage
      .from(meta.bucket)
      .upload(objectKey, file, { contentType: meta.contentType });
    if (error) throw new FileStoreError(error.message);
    return { fileRef: `${meta.bucket}/${objectKey}` };
  }

  async getUrl(fileRef: string, opts?: { expirySeconds?: number }) {
    const [bucket, objectKey] = splitFileRef(fileRef);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(objectKey, opts?.expirySeconds ?? 300);
    if (error || !data) throw new FileStoreError(error?.message ?? 'unknown error');
    return data.signedUrl;
  }

  async delete(fileRef: string) {
    const [bucket, objectKey] = splitFileRef(fileRef);
    const { error } = await this.supabase.storage.from(bucket).remove([objectKey]);
    if (error) throw new FileStoreError(error.message);
  }
}
