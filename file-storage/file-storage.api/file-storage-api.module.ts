import { DynamicModule, Module } from '@nestjs/common';
import { FILE_STORAGE_API_AUDIT_EMITTER, FILE_STORAGE_API_USER_DIRECTORY } from './tokens';
import type { FileStorageApiModuleConfig } from './file-storage-api.options';
import { NoopFileStorageApiAuditEmitter } from './file-storage-audit.port';
import { FileInventoryApiService } from './inventory/file-inventory-api.service';
import { FileInventoryController } from './inventory/file-inventory.controller';
import { FileCategoryApiService } from './categories/file-category-api.service';
import { FileCategoryController } from './categories/file-category.controller';
import { FileRetentionApiService } from './retention/file-retention-api.service';
import { FileRetentionController } from './retention/file-retention.controller';

/**
 * HTTP endpoints for an ops / compliance file-administration UI, over the
 * `file-storage.core.postgres-drizzle` ports + `AttachmentService`. Opt-in,
 * stack-agnostic — it depends on `FILE_STORAGE_OBSERVABILITY_PORT` /
 * `FILE_CATEGORY_ADMIN_PORT` / `AttachmentService` (via `imports`), never on a
 * stack adapter directly.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('file.*')`. Audit of the destructive ops is opt-in
 * via `auditEmitterToken`.
 *
 * ```typescript
 * FileStorageApiModule.forRoot({
 *   auditEmitterToken: MY_AUDIT_EMITTER,   // optional
 *   imports: [
 *     PostgresFileStorageAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
 *     PostgresFileCategoryModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
 *     // FileStorageModule.forRoot(...) exports AttachmentService — import it here too if not otherwise visible.
 *   ],
 * })
 * ```
 */
@Module({})
export class FileStorageApiModule {
  static forRoot(config: FileStorageApiModuleConfig = {}): DynamicModule {
    return {
      module: FileStorageApiModule,
      imports: config.imports ?? [],
      // FileInventoryController last: Express matches in registration order, and its
      // `GET files/:id` would otherwise answer `GET files/categories` / `GET files/retention`.
      controllers: [FileCategoryController, FileRetentionController, FileInventoryController],
      providers: [
        config.auditEmitterToken
          ? { provide: FILE_STORAGE_API_AUDIT_EMITTER, useExisting: config.auditEmitterToken }
          : { provide: FILE_STORAGE_API_AUDIT_EMITTER, useClass: NoopFileStorageApiAuditEmitter },
        config.userDirectoryToken
          ? { provide: FILE_STORAGE_API_USER_DIRECTORY, useExisting: config.userDirectoryToken }
          : { provide: FILE_STORAGE_API_USER_DIRECTORY, useValue: null },
        FileInventoryApiService,
        FileCategoryApiService,
        FileRetentionApiService,
      ],
    };
  }
}
