/**
 * File metadata lives in Postgres, not only in the storage provider — this
 * is what makes "all KYC documents for issuer X" a plain query, not a call
 * to the storage API to enumerate files.
 */
export interface FileRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly fileRef: string; // opaque reference into FileStore
  readonly category: string; // a FileCategory key — 'kyc.identity-document' | ... — consumer-defined
  readonly contentType: string;
  readonly sizeBytes: number;
  /**
   * SHA-256 of the uploaded bytes, hex. Passive — recorded at attach time for
   * forensics and a future dedupe story; nothing keys on it today. `null` for
   * rows written before it was captured, or by a store that doesn't compute it.
   */
  readonly contentHash: string | null;
  readonly uploadedBy: string;
  readonly createdAt: Date;
}
