/**
 * Injection tokens for the Supabase `FileStore` backend (Model 1). Symbols,
 * not string literals — a typo in a binding is a compile error.
 */

/** The consumer's own already-configured Supabase client, aliased in via `SupabaseFileStoreModule.forRoot()`. This library never creates one. */
export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');

/** `SupabaseFileStore`, bound by this package's module. Point `FileStorageModule.forRoot({ fileStoreToken })` at this. */
export const SUPABASE_FILE_STORE = Symbol('SUPABASE_FILE_STORE');
