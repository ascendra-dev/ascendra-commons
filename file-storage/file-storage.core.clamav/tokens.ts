/** Injection tokens for the clamd scanner. Symbols, not string literals. */

/** `ClamdFileScanner`. Point `FileStorageModule.forRoot({ fileScannerToken })` at this. */
export const CLAMD_FILE_SCANNER = Symbol('CLAMD_FILE_SCANNER');

/** The resolved `ClamdOptions`. */
export const CLAMD_OPTIONS = Symbol('CLAMD_OPTIONS');
