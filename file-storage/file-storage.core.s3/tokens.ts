/**
 * Injection tokens for the S3 `FileStore` backend (Model 2). Symbols, not
 * string literals — a typo in a binding is a compile error.
 */

/** The consumer's own configured `S3Client`, aliased in via `S3FileStoreModule.forRoot()`. This library never creates one. */
export const S3_CLIENT = Symbol('S3_CLIENT');

/** `S3FileStore`, bound by this package's module. Point `FileStorageModule.forRoot({ fileStoreToken })` at this. */
export const S3_FILE_STORE = Symbol('S3_FILE_STORE');

/** The resolved `S3FileStoreOptions`. */
export const S3_FILE_STORE_OPTIONS = Symbol('S3_FILE_STORE_OPTIONS');
