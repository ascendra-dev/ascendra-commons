import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORAGE_OBSERVABILITY_PORT } from '../../file-storage.core';
import {
  FILE_STORAGE_SQL_EXECUTOR,
  POSTGRES_FILE_ACCESS_RECORDER,
  POSTGRES_FILE_STORAGE_OBSERVABILITY,
} from '../tokens';
import { PostgresFileAccessRecorder } from './postgres-file-access-recorder';
import { PostgresFileStorageObservabilityService } from './postgres-file-storage-observability.service';

export interface PostgresFileStorageAdminModuleConfig {
  /** The token the consumer's database client (the `SqlExecutor` shape) is provided under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  imports?: DynamicModule['imports'];
}

/**
 * Binds:
 *   - `PostgresFileAccessRecorder` → `POSTGRES_FILE_ACCESS_RECORDER` (point
 *     `FileStorageModule.forRoot({ fileAccessRecorderToken })` at it),
 *   - `PostgresFileStorageObservabilityService` → the core
 *     `FILE_STORAGE_OBSERVABILITY_PORT` (consumed by `file-storage.api`).
 */
@Module({})
export class PostgresFileStorageAdminModule {
  static forRoot(config: PostgresFileStorageAdminModuleConfig): DynamicModule {
    return {
      module: PostgresFileStorageAdminModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORAGE_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresFileAccessRecorder,
        { provide: POSTGRES_FILE_ACCESS_RECORDER, useExisting: PostgresFileAccessRecorder },
        PostgresFileStorageObservabilityService,
        { provide: POSTGRES_FILE_STORAGE_OBSERVABILITY, useExisting: PostgresFileStorageObservabilityService },
        { provide: FILE_STORAGE_OBSERVABILITY_PORT, useExisting: PostgresFileStorageObservabilityService },
      ],
      exports: [POSTGRES_FILE_ACCESS_RECORDER, POSTGRES_FILE_STORAGE_OBSERVABILITY, FILE_STORAGE_OBSERVABILITY_PORT],
    };
  }
}
