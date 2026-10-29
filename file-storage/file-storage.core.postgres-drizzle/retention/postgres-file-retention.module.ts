import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORAGE_SQL_EXECUTOR, POSTGRES_FILE_RETENTION_STORE } from '../tokens';
import { PostgresFileRetentionStore } from './postgres-file-retention-store';

export interface PostgresFileRetentionModuleConfig {
  /** The token the consumer's database client (the `SqlExecutor` shape) is provided under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  imports?: DynamicModule['imports'];
}

/**
 * Binds `PostgresFileRetentionStore` → `POSTGRES_FILE_RETENTION_STORE`. Point
 * `FileStorageModule.forRoot({ fileRetentionStoreToken })` at it, then call
 * `FileRetentionService.run()` from the project's scheduler.
 */
@Module({})
export class PostgresFileRetentionModule {
  static forRoot(config: PostgresFileRetentionModuleConfig): DynamicModule {
    return {
      module: PostgresFileRetentionModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORAGE_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresFileRetentionStore,
        { provide: POSTGRES_FILE_RETENTION_STORE, useExisting: PostgresFileRetentionStore },
      ],
      exports: [POSTGRES_FILE_RETENTION_STORE],
    };
  }
}
