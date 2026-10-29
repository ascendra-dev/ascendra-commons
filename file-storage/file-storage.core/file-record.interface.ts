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
  /** The uploader's name for the file, cleaned — no path, no control characters, at most 255. `null` for older rows. */
  readonly filename: string | null;
  /** What the scanner said — an infected file is never stored. `null` for older rows. */
  readonly scanVerdict: 'clean' | 'unscannable' | null;
  /**
   * Fixed at upload from the category's `keepForDays` (a later catalog change
   * doesn't move it): the file can't be deleted before this date, and the
   * retention run deletes it after. `null` = indefinite.
   */
  readonly retainUntil: Date | null;
  /** Legal hold — while set, nobody deletes the file and retention skips it. */
  readonly legalHold: LegalHold | null;
  readonly createdAt: Date;
}

export interface LegalHold {
  readonly heldAt: Date;
  readonly heldBy: string;
  readonly reason: string;
}
