/**
 * Injection tokens for the local-disk `FileStore` backend. Symbols, not string
 * literals — a typo in a binding is a compile error.
 */

/** `LocalDiskFileStore`, bound by this package's module. Point `FileStorageModule.forRoot({ fileStoreToken })` at this. */
export const LOCAL_DISK_FILE_STORE = Symbol('LOCAL_DISK_FILE_STORE');

/** The resolved `LocalDiskOptions` — root directory, public URL, signing secret. */
export const LOCAL_DISK_OPTIONS = Symbol('LOCAL_DISK_OPTIONS');
