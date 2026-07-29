/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error,
 * not a silently unbound provider.
 */

/** The consumer's Supabase client, aliased in via FileStorageModule.forRoot() — this library never creates its own. */
export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');

/** Bucket/key strategy data — see FileStoreConfig. */
export const FILE_STORE_CONFIG = Symbol('FILE_STORE_CONFIG');

/** Record<entityType, EntityAccessChecker> — see RegistryAttachmentAuthorizer. */
export const ENTITY_ACCESS_CHECKERS = Symbol('ENTITY_ACCESS_CHECKERS');

/** What feature code actually depends on — bound to whichever FileStore implementation the app uses. */
export const FILE_STORE = Symbol('FILE_STORE');

/** The consumer's own FileRecord/Attachment persistence implementation, aliased in via FileStorageModule.forRoot(). */
export const ATTACHMENT_STORE = Symbol('ATTACHMENT_STORE');
