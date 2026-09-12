/* ports & domain types */
export type { FileStore } from './file-store.port';
export type { FileStoreConfig } from './file-store-config';
export { FileStoreError } from './file-store.error';
export type { FileRecord } from './file-record.interface';
export type { Attachment } from './attachment.interface';
export type { AttachmentStore } from './attachment-store.port';
export type { EntityAccessChecker } from './entity-access-checker.interface';
export { RegistryAttachmentAuthorizer } from './attachment-authorizer';

/* file categories */
export type { FileCategory, ResolvedFileCategory, Retention, RetentionPolicy, FileCategoryRegistry } from './file-category';
export { assertFileMatchesCategory } from './file-category';

/* validation / scanning / access */
export type { FileValidator, FileValidationTarget, FileValidationDefaults } from './file-validator.port';
export { RuleBasedFileValidator, FileValidationError, extensionOf } from './file-validator.port';
export type { FileScanner, ScanVerdict } from './file-scanner.port';
export { NoopFileScanner } from './file-scanner.port';
export type { FileAccessRecorder, FileAccessEvent } from './file-access-recorder.port';
export { NoopFileAccessRecorder } from './file-access-recorder.port';
export type { SignedLinkResolver } from './signed-link-resolver.port';
export { MissingSignedLinkResolver, MissingSignedLinkResolverError } from './signed-link-resolver.port';

/* audit */
export type { FileStorageAuditEmitter, FileStorageAuditEvent } from './file-storage-audit.port';
export { NoopFileStorageAuditEmitter } from './file-storage-audit.port';

/* orchestration */
export { AttachmentService } from './attachment.service';
export type { UploadInput, DownloadPurpose } from './attachment.service';

/* observability + category admin ports (implemented by a stack adapter, consumed by file-storage.api) */
export type { FileStorageObservabilityPort } from './file-storage-observability.port';
export { FILE_STORAGE_OBSERVABILITY_PORT } from './file-storage-observability.port';
export type { FileCategoryAdminPort } from './file-category-admin.port';
export { FILE_CATEGORY_ADMIN_PORT } from './file-category-admin.port';
export type {
  FileInventoryQuery,
  FileInventoryRow,
  FileInventoryPage,
  FileDetail,
  StorageUsageQuery,
  StorageUsageRow,
  OrphanedFileQuery,
  OrphanedFileRow,
  OrphanedFilePage,
  FileAccessLogEntry,
  FileAccessLogPage,
  CategoryUsageRow,
  FileCategoryOverrideInput,
  FileCategoryView,
} from './file-storage-admin.types';
export { CategoryNotFoundError, CategoryLooseningNotAllowedError } from './file-storage-admin.types';

/* pagination helper */
export { encodeKeysetCursor, decodeKeysetCursor } from './keyset-cursor';

/* module + options */
export { FileStorageModule } from './file-storage.module';
export type { FileStorageModuleConfig } from './file-storage.module';
export type { FileStorageOptions, DownloadUrlExpiry } from './file-storage.options';
export { resolveFileStorageOptions } from './file-storage.options';

/* tokens */
export {
  FILE_STORE,
  ATTACHMENT_STORE,
  FILE_CATEGORY_REGISTRY,
  FILE_VALIDATOR,
  FILE_SCANNER,
  FILE_ACCESS_RECORDER,
  SIGNED_LINK_RESOLVER,
  FILE_STORAGE_AUDIT_EMITTER,
  FILE_STORAGE_OPTIONS,
  FILE_STORE_CONFIG,
  ENTITY_ACCESS_CHECKERS,
} from './tokens';
