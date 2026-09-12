import { DynamicModule, Module } from '@nestjs/common';
import { FILE_CATEGORY_ADMIN_PORT, type FileCategory } from '../../file-storage.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { FILE_CATEGORY_CACHE, FILE_STORAGE_SQL_EXECUTOR, POSTGRES_FILE_CATEGORY_ADMIN, POSTGRES_FILE_CATEGORY_REGISTRY } from '../tokens';
import { CategoryCache } from './category-cache';
import { PostgresFileCategoryRegistry } from './postgres-file-category-registry';
import { PostgresFileCategoryAdminService } from './postgres-file-category-admin.service';
import { seedFileCategories } from './seed/seed-file-categories';

const SEED_RUNNER = Symbol('FILE_CATEGORY_SEED_RUNNER');

export interface PostgresFileCategoryModuleConfig {
  /** The token the consumer's database client (the `SqlExecutor` shape) is provided under. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Developer-declared **base** category definitions. Upserted insert-if-absent
   * on boot (`source = 'seed'`). Omit to seed nothing here (run
   * `seedFileCategories` yourself from a migration/CLI instead).
   */
  seedCategories?: FileCategory[];
  /** Category-resolution cache TTL, ms. Default 60000. `0` disables it (an admin edit is then instantly visible). */
  cacheTtlMs?: number;
  imports?: DynamicModule['imports'];
}

/**
 * Binds `PostgresFileCategoryRegistry` (→ `POSTGRES_FILE_CATEGORY_REGISTRY`,
 * point `FileStorageModule.forRoot({ fileCategoryRegistryToken })` at it) and
 * `PostgresFileCategoryAdminService` (→ the core `FILE_CATEGORY_ADMIN_PORT`,
 * consumed by `file-storage.api`). Seeds base categories on boot.
 */
@Module({})
export class PostgresFileCategoryModule {
  static forRoot(config: PostgresFileCategoryModuleConfig): DynamicModule {
    return {
      module: PostgresFileCategoryModule,
      imports: config.imports ?? [],
      providers: [
        { provide: FILE_STORAGE_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: FILE_CATEGORY_CACHE, useValue: new CategoryCache(config.cacheTtlMs ?? 60_000) },
        PostgresFileCategoryRegistry,
        { provide: POSTGRES_FILE_CATEGORY_REGISTRY, useExisting: PostgresFileCategoryRegistry },
        PostgresFileCategoryAdminService,
        { provide: POSTGRES_FILE_CATEGORY_ADMIN, useExisting: PostgresFileCategoryAdminService },
        { provide: FILE_CATEGORY_ADMIN_PORT, useExisting: PostgresFileCategoryAdminService },
        {
          provide: SEED_RUNNER,
          useFactory: async (db: SqlExecutor) => {
            if (config.seedCategories?.length) await seedFileCategories(db, config.seedCategories);
            return true;
          },
          inject: [FILE_STORAGE_SQL_EXECUTOR],
        },
      ],
      exports: [POSTGRES_FILE_CATEGORY_REGISTRY, POSTGRES_FILE_CATEGORY_ADMIN, FILE_CATEGORY_ADMIN_PORT],
    };
  }
}
