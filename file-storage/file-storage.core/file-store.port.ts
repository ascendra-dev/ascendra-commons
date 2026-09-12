/**
 * The blob port. Feature code depends only on this, never on the backing
 * provider's SDK directly, so the provider can change without touching call
 * sites.
 *
 * No `Actor` anywhere — this interface is access-path-agnostic by design.
 * Whether a caller must be an authenticated actor is a decision for whatever
 * sits in front of it (`AttachmentService`, or the vertical's own controller),
 * not `FileStore` itself.
 *
 * `bucket` is supplied by the caller (resolved from the file's `FileCategory`),
 * not derived here — a backend never needs to know the category-to-bucket
 * mapping, only where to put the bytes.
 */
export interface FileStore {
  upload(
    file: Buffer,
    meta: {
      contentType: string;
      filename: string;
      category: string;
      tenantId: string | null;
      bucket: string;
    },
  ): Promise<{ fileRef: string }>;

  getUrl(fileRef: string, opts?: { expirySeconds?: number }): Promise<string>;

  /** Explicit deletion (a GDPR-style erase, or `AttachmentService.deleteFile`) — detaching an `Attachment` never calls this. */
  delete(fileRef: string): Promise<void>;
}
