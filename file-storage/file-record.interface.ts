/**
 * File metadata lives in Postgres, not only in the storage provider — this
 * is what makes "all KYC documents for issuer X" a plain query, not a call
 * to the storage API to enumerate files.
 */
export interface FileRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly fileRef: string; // opaque reference into FileStore
  readonly category: string; // 'invoice-pdf' | 'kyc-document' | 'receipt' | ... — consumer-defined
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string;
  readonly createdAt: Date;
}
