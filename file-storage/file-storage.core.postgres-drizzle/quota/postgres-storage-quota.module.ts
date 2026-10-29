import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORAGE_SQL_EXECUTOR, POSTGRES_STORAGE_QUOTA_STORE } from '../tokens';
import { PostgresStorageQuotaStore } from './postgres-storage-quota-store';

export interface PostgresStorageQuotaModuleConfig {
  /** The token the consumer's database client (the `SqlExecutor` shape) is provided under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  imports?: DynamicModule['imports'];
}

/** Binds `PostgresStorageQuotaStore` → `POSTGRES_STORAGE_QUOTA_STORE`; point `FileStorageModule.forRoot({ storageQuotaStoreToken })` at it. */
@Module({})
export class PostgresStorageQuotaModule {
  static forRoot(config: PostgresStorageQuotaModuleConfig): DynamicModule {
    return {
      module: PostgresStorageQuotaModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORAGE_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresStorageQuotaStore,
        { provide: POSTGRES_STORAGE_QUOTA_STORE, useExisting: PostgresStorageQuotaStore },
      ],
      exports: [POSTGRES_STORAGE_QUOTA_STORE],
    };
  }
}
