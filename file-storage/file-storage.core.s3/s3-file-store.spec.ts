import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { S3FileStore, S3FileStoreNotImplementedError } from './s3-file-store';
import { S3FileStoreModule } from './s3-file-store.module';
import { S3_FILE_STORE } from './tokens';
import type { FileStore } from '../file-storage.core';

describe('S3FileStore (stub)', () => {
  it('every method throws S3FileStoreNotImplementedError', async () => {
    const store = new S3FileStore();
    await expect(store.upload()).rejects.toBeInstanceOf(S3FileStoreNotImplementedError);
    await expect(store.getUrl()).rejects.toBeInstanceOf(S3FileStoreNotImplementedError);
    await expect(store.delete()).rejects.toBeInstanceOf(S3FileStoreNotImplementedError);
  });

  it('the module binds it under S3_FILE_STORE', async () => {
    const ref = await Test.createTestingModule({ imports: [S3FileStoreModule.forRoot()] }).compile();
    const store = ref.get<FileStore>(S3_FILE_STORE);
    await expect(store.getUrl('x')).rejects.toBeInstanceOf(S3FileStoreNotImplementedError);
  });
});
