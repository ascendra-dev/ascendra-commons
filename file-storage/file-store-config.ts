/**
 * Which bucket a category's files live in, and what an object's key looks
 * like, are both real decisions with real tradeoffs — one shared bucket is
 * simpler; a dedicated bucket per sensitive category makes it possible to
 * set bucket-level policy independent of application code. An opaque random
 * key is simplest; a structured, tenant-prefixed key makes a bucket
 * browsable by tenant in the provider's own dashboard. Neither is
 * universally correct, so neither is hardcoded into SupabaseFileStore —
 * both are supplied here, by the consumer.
 */
export interface FileStoreConfig {
  bucketForCategory(category: string): string;
  buildObjectKey(meta: { tenantId: string | null; category: string; filename: string }): string;
}
