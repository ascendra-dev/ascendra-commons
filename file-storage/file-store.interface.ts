/**
 * Feature code depends only on this, never on the backing provider's SDK
 * directly, so the provider can change without touching call sites. No
 * Actor anywhere — this interface is already access-path-agnostic by
 * design; whether a caller needs to be an authenticated actor at all is a
 * decision for whatever sits in front of this, not FileStore itself (see
 * this pattern's README for the anonymous-access case).
 */
export interface FileStore {
  upload(
    file: Buffer,
    meta: { contentType: string; filename: string; category: string; tenantId: string | null },
  ): Promise<{ fileRef: string }>;
  getUrl(fileRef: string, opts?: { expirySeconds?: number }): Promise<string>;
  /** Reserved for a future explicit deletion flow (e.g. a GDPR-style request) — detaching an Attachment never calls this. */
  delete(fileRef: string): Promise<void>;
}
