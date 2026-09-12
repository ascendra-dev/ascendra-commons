import { DynamicModule, Module } from '@nestjs/common';
import { S3FileStore } from './s3-file-store';
import { S3_FILE_STORE } from './tokens';

/**
 * Model 2 blob backend seam. `forRoot()` takes no config — there is nothing
 * to configure until the store is built. Binds `S3FileStore` (throws on every
 * call) under `S3_FILE_STORE`.
 */
@Module({})
export class S3FileStoreModule {
  static forRoot(): DynamicModule {
    return {
      module: S3FileStoreModule,
      providers: [S3FileStore, { provide: S3_FILE_STORE, useExisting: S3FileStore }],
      exports: [S3_FILE_STORE],
    };
  }
}
