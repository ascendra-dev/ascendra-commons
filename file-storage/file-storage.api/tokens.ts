/** Injection tokens for `file-storage.api`. Symbols, not string literals. */

/** Optional `FileStorageApiAuditEmitter` — records the destructive admin operations, or the no-op. */
export const FILE_STORAGE_API_AUDIT_EMITTER = Symbol('FILE_STORAGE_API_AUDIT_EMITTER');

/** The optional `FileStorageUserDirectory` — names for uploaders and downloaders — or `null`. */
export const FILE_STORAGE_API_USER_DIRECTORY = Symbol('FILE_STORAGE_API_USER_DIRECTORY');
