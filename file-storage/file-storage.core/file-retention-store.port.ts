import type { FileRecord } from './file-record.interface';

/**
 * The persistence side of retention — bound by a stack adapter under
 * `fileRetentionStoreToken`, used by `FileRetentionService`. Every method
 * works in bounded batches so a backlog never holds one long lock.
 */
export interface FileRetentionStore {
  /** Files whose `retainUntil` has passed and that aren't held — oldest date first. */
  findExpiredFiles(now: Date, limit: number): Promise<FileRecord[]>;

  /**
   * Files with no attachment, created before `olderThan`, not held and past
   * their retention date (or with none) — what an orphan purge may delete.
   * `tenantId` set → only that tenant's.
   */
  findPurgeableOrphans(query: { olderThan: Date; now: Date; tenantId?: string; limit: number }): Promise<FileRecord[]>;

  /** What an orphan purge with these bounds would do — how many go, and how many it leaves and why. Reads only. */
  previewOrphanPurge(query: { olderThan: Date; now: Date; tenantId?: string }): Promise<OrphanPurgePreview>;

  /** Which of these `fileRef`s a `FileRecord` holds — the rest are stray blobs. */
  findRecordedRefs(fileRefs: string[]): Promise<Set<string>>;

  /** Deletes access-log rows older than `before`. Returns how many went. */
  pruneAccessLog(before: Date, batchSize: number): Promise<number>;

  /** Deletes rejected-upload rows older than `before` (they carry filenames). Returns how many went. */
  pruneRejections(before: Date, batchSize: number): Promise<number>;

  /** What retention is working on — for the console's Volume & retention screen. `tenantId` set → that tenant's rows only. */
  volume(now: Date, tenantId?: string): Promise<FileRetentionVolume>;
}

/** Orphans older than the purge's bound: those it deletes, and those it leaves (held; inside their retention date). */
export interface OrphanPurgePreview {
  purgeable: { count: number; bytes: number };
  held: number;
  retained: number;
}

export interface FileRetentionVolume {
  files: {
    count: number;
    totalBytes: number;
    /** Past their retention date and not held — the next retention run deletes these. */
    pastRetention: number;
    /** Retention date within the next 30 days. */
    expiringWithin30Days: number;
    /** No retention date — kept until someone deletes them. */
    indefinite: number;
    held: number;
    oldestCreatedAt: Date | null;
  };
  accessLog: { rows: number; oldestAt: Date | null };
  rejections: { rows: number; oldestAt: Date | null };
}

export class MissingFileRetentionStoreError extends Error {
  constructor() {
    super(
      'No FileRetentionStore is bound. Retention and orphan purges need one — bind it via ' +
        "FileStorageModule.forRoot({ fileRetentionStoreToken }) (file-storage.core.postgres-drizzle's POSTGRES_FILE_RETENTION_STORE).",
    );
    this.name = 'MissingFileRetentionStoreError';
  }
}

/** The default — every call throws until the consumer binds a real store. */
export class MissingFileRetentionStore implements FileRetentionStore {
  async findExpiredFiles(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
  async findPurgeableOrphans(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
  async previewOrphanPurge(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
  async findRecordedRefs(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
  async pruneAccessLog(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
  async pruneRejections(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
  async volume(): Promise<never> {
    throw new MissingFileRetentionStoreError();
  }
}
