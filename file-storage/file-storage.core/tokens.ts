/**
 * Injection tokens. Symbols, not string literals — a typo in a binding is a
 * compile error, not a silently unbound provider. Same reasoning as every
 * other module in this library.
 */

/** What feature code depends on — bound to whichever `FileStore` backend the app wires (Supabase Model 1, S3 Model 2, or its own). */
export const FILE_STORE = Symbol('FILE_STORE');

/** The consumer's `FileRecord`/`Attachment` persistence — `file-storage.core.postgres-drizzle` or the consumer's own. */
export const ATTACHMENT_STORE = Symbol('ATTACHMENT_STORE');

/** The database-backed file-category catalog — `file-storage.core.postgres-drizzle`'s `PostgresFileCategoryRegistry`, or the consumer's own. Required. */
export const FILE_CATEGORY_REGISTRY = Symbol('FILE_CATEGORY_REGISTRY');

/** App-global upload rules (hard size ceiling, MIME/extension denylist). Defaults to `RuleBasedFileValidator` built from `validationDefaults`. */
export const FILE_VALIDATOR = Symbol('FILE_VALIDATOR');

/** Malware/content scan hook. Defaults to `NoopFileScanner` (every file reported `clean` — bind a real scanner in production). */
export const FILE_SCANNER = Symbol('FILE_SCANNER');

/** Best-effort download access log. Defaults to `NoopFileAccessRecorder`. */
export const FILE_ACCESS_RECORDER = Symbol('FILE_ACCESS_RECORDER');

/** Best-effort rejected-upload log (bad category, validation failure, failed/rejected scan). Defaults to `NoopFileUploadRejectionRecorder`. */
export const FILE_UPLOAD_REJECTION_RECORDER = Symbol('FILE_UPLOAD_REJECTION_RECORDER');

/** Validates an opaque share token → `fileRecordId`. Defaults to `MissingSignedLinkResolver` (throws until the consumer binds one). */
export const SIGNED_LINK_RESOLVER = Symbol('SIGNED_LINK_RESOLVER');

/** Best-effort audit hook for attach / link / detach / delete. Defaults to `NoopFileStorageAuditEmitter`. */
export const FILE_STORAGE_AUDIT_EMITTER = Symbol('FILE_STORAGE_AUDIT_EMITTER');

/** The persistence side of retention — `file-storage.core.postgres-drizzle`'s, or the consumer's own. Defaults to `MissingFileRetentionStore` (throws). */
export const FILE_RETENTION_STORE = Symbol('FILE_RETENTION_STORE');

/** Resolved `FileStorageOptions` — `isPlatformAdmin` predicate + download-URL expiry defaults. */
export const FILE_STORAGE_OPTIONS = Symbol('FILE_STORAGE_OPTIONS');

/** The bucket/object-key strategy — consumed by a `FileStore` backend, not by `.core` itself. Bound by the backend's own module. */
export const FILE_STORE_CONFIG = Symbol('FILE_STORE_CONFIG');

/** `Record<entityType, EntityAccessChecker>` — consumed by `RegistryAttachmentAuthorizer` (a tool for the vertical's own controllers). */
export const ENTITY_ACCESS_CHECKERS = Symbol('ENTITY_ACCESS_CHECKERS');
