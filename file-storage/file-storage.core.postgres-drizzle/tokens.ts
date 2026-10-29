/**
 * Injection tokens for the Postgres/Drizzle metadata backend. Symbols, not
 * string literals — a typo in a binding is a compile error.
 */

/** The consumer's database client — the minimal `SqlExecutor` shape, aliased in via each `forRoot({ sqlExecutorToken })`. */
export const FILE_STORAGE_SQL_EXECUTOR = Symbol('FILE_STORAGE_SQL_EXECUTOR');

/** `PostgresAttachmentStore`. Point `FileStorageModule.forRoot({ attachmentStoreToken })` at this. */
export const POSTGRES_ATTACHMENT_STORE = Symbol('POSTGRES_ATTACHMENT_STORE');

/** `PostgresFileCategoryRegistry`. Point `FileStorageModule.forRoot({ fileCategoryRegistryToken })` at this. */
export const POSTGRES_FILE_CATEGORY_REGISTRY = Symbol('POSTGRES_FILE_CATEGORY_REGISTRY');

/** `PostgresFileAccessRecorder`. Point `FileStorageModule.forRoot({ fileAccessRecorderToken })` at this. */
export const POSTGRES_FILE_ACCESS_RECORDER = Symbol('POSTGRES_FILE_ACCESS_RECORDER');

/** `PostgresFileUploadRejectionRecorder`. Point `FileStorageModule.forRoot({ fileUploadRejectionRecorderToken })` at this. */
export const POSTGRES_FILE_UPLOAD_REJECTION_RECORDER = Symbol('POSTGRES_FILE_UPLOAD_REJECTION_RECORDER');

/** Resolved options for the category module — seed list + cache TTL. */
export const FILE_CATEGORY_MODULE_OPTIONS = Symbol('FILE_CATEGORY_MODULE_OPTIONS');

/** The shared `CategoryCache` instance — the registry reads through it, the admin service clears it. */
export const FILE_CATEGORY_CACHE = Symbol('FILE_CATEGORY_CACHE');

/** `PostgresFileStorageObservabilityService`, bound under the core `FILE_STORAGE_OBSERVABILITY_PORT` too. */
export const POSTGRES_FILE_STORAGE_OBSERVABILITY = Symbol('POSTGRES_FILE_STORAGE_OBSERVABILITY');

/** `PostgresFileCategoryAdminService`, bound under the core `FILE_CATEGORY_ADMIN_PORT` too. */
export const POSTGRES_FILE_CATEGORY_ADMIN = Symbol('POSTGRES_FILE_CATEGORY_ADMIN');

/** `PostgresFileRetentionStore`. Point `FileStorageModule.forRoot({ fileRetentionStoreToken })` at this. */
export const POSTGRES_FILE_RETENTION_STORE = Symbol('POSTGRES_FILE_RETENTION_STORE');

/** `PostgresStorageQuotaStore`. Point `FileStorageModule.forRoot({ storageQuotaStoreToken })` at this. */
export const POSTGRES_STORAGE_QUOTA_STORE = Symbol('POSTGRES_STORAGE_QUOTA_STORE');
