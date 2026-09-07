/**
 * What an object's storage key looks like is a real decision with real
 * tradeoffs — an opaque random key is simplest; a structured, tenant-prefixed
 * key makes a bucket browsable by tenant in the provider's own dashboard.
 * Neither is universally correct, so neither is hardcoded into a `FileStore`
 * backend — the consumer supplies it, bound by the backend's own module.
 *
 * The *bucket* is no longer here: it's a field on the file's `FileCategory`
 * (see `file-storage.core.postgres-drizzle`'s category catalog), resolved by
 * `AttachmentService` and passed to `FileStore.upload`.
 */
export interface FileStoreConfig {
  buildObjectKey(meta: { tenantId: string | null; category: string; filename: string }): string;
}
