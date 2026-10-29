import { isAbsolute } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORE_CONFIG, type FileStoreConfig } from '../file-storage.core';
import { createLocalDiskBlobController } from './local-disk-blob.controller';
import { LocalDiskFileStore, type LocalDiskOptions } from './local-disk-file-store';
import { LOCAL_DISK_FILE_STORE, LOCAL_DISK_OPTIONS } from './tokens';

export interface LocalDiskFileStoreModuleConfig extends LocalDiskOptions {
  /** Object-key strategy — see `FileStoreConfig`. Never the client's filename verbatim. */
  fileStoreConfig: FileStoreConfig;
  /** Route the signed URLs are served from — `publicBaseUrl` must point at it. Default `local-files`. */
  routePath?: string;
  /**
   * Class decorators for the serving controller — the app's own "no login
   * needed" marker (e.g. `Public()`), since the token is the grant and the
   * app's authentication guard is not this library's.
   */
  routeDecorators?: ClassDecorator[];
}

/**
 * The local-disk blob backend — for development, tests and a single-node
 * deployment. Binds `LocalDiskFileStore` under `LOCAL_DISK_FILE_STORE` (point
 * `FileStorageModule.forRoot({ fileStoreToken })` at it) and registers the
 * controller that serves its signed URLs.
 */
@Module({})
export class LocalDiskFileStoreModule {
  static forRoot(config: LocalDiskFileStoreModuleConfig): DynamicModule {
    if (!config?.rootDir || !isAbsolute(config.rootDir)) {
      throw new Error('LocalDiskFileStoreModule.forRoot() requires an absolute rootDir');
    }
    if (!config.publicBaseUrl || !/^https?:\/\//.test(config.publicBaseUrl)) {
      throw new Error('LocalDiskFileStoreModule.forRoot() requires publicBaseUrl — the http(s) URL its route is reachable at');
    }
    if (!config.signingSecret || config.signingSecret.length < 32) {
      throw new Error('LocalDiskFileStoreModule.forRoot() requires a signingSecret of at least 32 characters');
    }
    const options: LocalDiskOptions = {
      rootDir: config.rootDir,
      publicBaseUrl: config.publicBaseUrl,
      signingSecret: config.signingSecret,
    };
    return {
      module: LocalDiskFileStoreModule,
      controllers: [createLocalDiskBlobController(config.routePath ?? 'local-files', config.routeDecorators ?? [])],
      providers: [
        { provide: LOCAL_DISK_OPTIONS, useValue: options },
        { provide: FILE_STORE_CONFIG, useValue: config.fileStoreConfig },
        LocalDiskFileStore,
        { provide: LOCAL_DISK_FILE_STORE, useExisting: LocalDiskFileStore },
      ],
      exports: [LOCAL_DISK_FILE_STORE, LocalDiskFileStore, FILE_STORE_CONFIG],
    };
  }
}
