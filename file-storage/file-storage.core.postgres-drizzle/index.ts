/* persistence (tables for typed queries — never re-exported to drizzle-kit; the DDL is migrations/) */
export {
  fileRecordTable,
  attachmentTable,
  fileCategoryTable,
  fileAccessTable,
  fileRejectionTable,
  tenantQuotaTable,
  pendingUploadTable,
} from './persistence';
export type { SqlExecutor } from './persistence/sql-executor';

/* attachment store (Model 1 metadata) */
export { PostgresAttachmentStore } from './attachment-store/postgres-attachment-store';
export { PostgresAttachmentStoreModule } from './attachment-store/postgres-attachment-store.module';
export type { PostgresAttachmentStoreModuleConfig } from './attachment-store/postgres-attachment-store.module';

/* category catalog */
export { PostgresFileCategoryRegistry } from './category-registry/postgres-file-category-registry';
export { PostgresFileCategoryAdminService } from './category-registry/postgres-file-category-admin.service';
export { PostgresFileCategoryModule } from './category-registry/postgres-file-category.module';
export type { PostgresFileCategoryModuleConfig } from './category-registry/postgres-file-category.module';
export { seedFileCategories } from './category-registry/seed/seed-file-categories';

/* access log + observability */
export { PostgresFileAccessRecorder } from './access-log/postgres-file-access-recorder';
export { PostgresFileStorageObservabilityService } from './access-log/postgres-file-storage-observability.service';
export { PostgresFileStorageAdminModule } from './access-log/postgres-file-storage-admin.module';
export type { PostgresFileStorageAdminModuleConfig } from './access-log/postgres-file-storage-admin.module';

/* retention */
export { PostgresFileRetentionStore } from './retention/postgres-file-retention-store';
export { PostgresFileRetentionModule } from './retention/postgres-file-retention.module';
export type { PostgresFileRetentionModuleConfig } from './retention/postgres-file-retention.module';

/* storage limits */
export { PostgresStorageQuotaStore } from './quota/postgres-storage-quota-store';
export { PostgresStorageQuotaModule } from './quota/postgres-storage-quota.module';
export type { PostgresStorageQuotaModuleConfig } from './quota/postgres-storage-quota.module';

/* direct uploads */
export { PostgresPendingUploadStore } from './pending-upload/postgres-pending-upload-store';
export { PostgresPendingUploadModule } from './pending-upload/postgres-pending-upload.module';
export type { PostgresPendingUploadModuleConfig } from './pending-upload/postgres-pending-upload.module';

/* rejected uploads */
export { PostgresFileUploadRejectionRecorder } from './rejections/postgres-file-upload-rejection-recorder';

/* tokens */
export {
  FILE_STORAGE_SQL_EXECUTOR,
  POSTGRES_ATTACHMENT_STORE,
  POSTGRES_FILE_CATEGORY_REGISTRY,
  POSTGRES_FILE_CATEGORY_ADMIN,
  POSTGRES_FILE_ACCESS_RECORDER,
  POSTGRES_FILE_UPLOAD_REJECTION_RECORDER,
  POSTGRES_FILE_STORAGE_OBSERVABILITY,
  POSTGRES_FILE_RETENTION_STORE,
  POSTGRES_STORAGE_QUOTA_STORE,
  POSTGRES_PENDING_UPLOAD_STORE,
} from './tokens';
