import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORAGE_SQL_EXECUTOR, POSTGRES_PENDING_UPLOAD_STORE } from '../tokens';
import { PostgresPendingUploadStore } from './postgres-pending-upload-store';

export interface PostgresPendingUploadModuleConfig {
  /** The token the consumer's database client (the `SqlExecutor` shape) is provided under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  imports?: DynamicModule['imports'];
}

/** Binds `PostgresPendingUploadStore` → `POSTGRES_PENDING_UPLOAD_STORE`; point `FileStorageModule.forRoot({ pendingUploadStoreToken })` at it. */
@Module({})
export class PostgresPendingUploadModule {
  static forRoot(config: PostgresPendingUploadModuleConfig): DynamicModule {
    return {
      module: PostgresPendingUploadModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORAGE_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresPendingUploadStore,
        { provide: POSTGRES_PENDING_UPLOAD_STORE, useExisting: PostgresPendingUploadStore },
      ],
      exports: [POSTGRES_PENDING_UPLOAD_STORE],
    };
  }
}
