/** Injection tokens for `file-storage.api`. Symbols, not string literals. */

/** `FileStorageApiOptions` — the platform-admin predicate. Bound by `FileStorageApiModule.forRoot()`. */
export const FILE_STORAGE_API_OPTIONS = Symbol('FILE_STORAGE_API_OPTIONS');

/** Optional `FileStorageApiAuditEmitter` — records the destructive admin operations, or the no-op. */
export const FILE_STORAGE_API_AUDIT_EMITTER = Symbol('FILE_STORAGE_API_AUDIT_EMITTER');
