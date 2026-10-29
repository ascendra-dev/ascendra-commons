import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORE_CONFIG, type FileStoreConfig } from '../file-storage.core';
import { S3FileStore, type S3FileStoreOptions } from './s3-file-store';
import { S3_CLIENT, S3_FILE_STORE, S3_FILE_STORE_OPTIONS } from './tokens';

export interface S3FileStoreModuleConfig extends S3FileStoreOptions {
  /** The token the app's own configured `S3Client` is provided under — this package never creates one. */
  s3ClientToken: string | symbol | (new (...args: never[]) => unknown);
  /** Object-key strategy — see `FileStoreConfig`. Never the client's filename verbatim. */
  fileStoreConfig: FileStoreConfig;
  /** Whatever module exports the provider behind `s3ClientToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Model 2 blob backend. Binds `S3FileStore` under `S3_FILE_STORE`; point
 * `FileStorageModule.forRoot({ fileStoreToken: S3_FILE_STORE })` at it and
 * import this in the same `imports` array.
 */
@Module({})
export class S3FileStoreModule {
  static forRoot(config: S3FileStoreModuleConfig): DynamicModule {
    if (!config?.s3ClientToken || !config.fileStoreConfig) {
      throw new Error('S3FileStoreModule.forRoot() requires s3ClientToken (the app\'s S3Client) and fileStoreConfig');
    }
    if (config.kmsKeyId && config.serverSideEncryption !== 'aws:kms') {
      throw new Error("S3FileStoreModule.forRoot(): kmsKeyId needs serverSideEncryption: 'aws:kms'");
    }
    const options: S3FileStoreOptions = {
      serverSideEncryption: config.serverSideEncryption,
      kmsKeyId: config.kmsKeyId,
      preventOverwrite: config.preventOverwrite,
    };
    return {
      module: S3FileStoreModule,
      imports: config.imports ?? [],
      providers: [
        { provide: S3_CLIENT, useExisting: config.s3ClientToken },
        { provide: FILE_STORE_CONFIG, useValue: config.fileStoreConfig },
        { provide: S3_FILE_STORE_OPTIONS, useValue: options },
        S3FileStore,
        { provide: S3_FILE_STORE, useExisting: S3FileStore },
      ],
      exports: [S3_FILE_STORE, FILE_STORE_CONFIG],
    };
  }
}
