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

  /**
   * A short-lived URL for the object. `filename` / `contentType` (from the
   * `FileRecord`) say how it should be served; a backend that can set response
   * headers per URL uses them, one that serves the stored metadata ignores them.
   */
  getUrl(
    fileRef: string,
    opts?: { expirySeconds?: number; filename?: string | null; contentType?: string },
  ): Promise<string>;

  /** Explicit deletion (a GDPR-style erase, or `AttachmentService.deleteFile`) — detaching an `Attachment` never calls this. */
  delete(fileRef: string): Promise<void>;
}
