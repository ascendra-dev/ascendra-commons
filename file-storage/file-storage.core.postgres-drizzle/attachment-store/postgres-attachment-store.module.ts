import { DynamicModule, Module } from '@nestjs/common';
import { PostgresAttachmentStore } from './postgres-attachment-store';
import { FILE_STORAGE_SQL_EXECUTOR, POSTGRES_ATTACHMENT_STORE } from '../tokens';

export interface PostgresAttachmentStoreModuleConfig {
  /** The token the consumer's database client (the `SqlExecutor` shape) is provided under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  imports?: DynamicModule['imports'];
}

/**
 * Binds `PostgresAttachmentStore` under `POSTGRES_ATTACHMENT_STORE`. Point
 * `FileStorageModule.forRoot({ attachmentStoreToken: POSTGRES_ATTACHMENT_STORE })`
 * at it, importing this in the same `imports` array.
 */
@Module({})
export class PostgresAttachmentStoreModule {
  static forRoot(config: PostgresAttachmentStoreModuleConfig): DynamicModule {
    return {
      module: PostgresAttachmentStoreModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORAGE_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresAttachmentStore,
        { provide: POSTGRES_ATTACHMENT_STORE, useExisting: PostgresAttachmentStore },
      ],
      exports: [POSTGRES_ATTACHMENT_STORE],
    };
  }
}
