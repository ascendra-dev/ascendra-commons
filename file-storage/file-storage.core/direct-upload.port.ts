import type { FileStore } from './file-store.port';

/**
 * A `FileStore` the client can upload to directly — the bytes go to the
 * bucket, not through the API. `AttachmentService.beginUpload` reserves a key
 * and hands out a short-lived upload URL; `completeUpload` checks the object
 * and reads it back for the content check, scan and hash before any record is
 * written. Optional: a store that can't presign uploads doesn't implement it.
 */
export interface DirectUploadFileStore extends FileStore {
  /** The `fileRef` a new upload will land at — `"{bucket}/{buildObjectKey(meta)}"`. Nothing is written. */
  reserveRef(meta: { tenantId: string; category: string; filename: string; bucket: string }): string;

  /**
   * A URL the client sends the bytes to, and the exact `headers` it must send
   * with them (a presigned URL is only valid with the headers it was signed
   * for). The store refuses a body larger than `sizeBytes`, and never
   * overwrites an existing object.
   */
  createUploadUrl(
    fileRef: string,
    opts: { contentType: string; sizeBytes: number; expirySeconds: number },
  ): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>;

  /** The object's size, or `null` when nothing is there. */
  stat(fileRef: string): Promise<{ sizeBytes: number } | null>;

  /** The object's bytes — for the content check, the scan and the hash. */
  read(fileRef: string): Promise<Buffer>;
}

export function isDirectUploadFileStore(store: FileStore): store is DirectUploadFileStore {
  const s = store as Partial<DirectUploadFileStore>;
  return typeof s.createUploadUrl === 'function' && typeof s.stat === 'function' && typeof s.read === 'function' && typeof s.reserveRef === 'function';
}

/** An upload that has been begun and not yet completed. */
export interface PendingUpload {
  id: string;
  tenantId: string;
  actorId: string;
  category: string;
  attachedToType: string;
  attachedToId: string;
  filename: string;
  contentType: string;
  /** The declared size — the object must be exactly this. */
  sizeBytes: number;
  fileRef: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Where begun uploads wait for `completeUpload`. Bound under `pendingUploadStoreToken`. */
export interface PendingUploadStore {
  create(upload: Omit<PendingUpload, 'id' | 'createdAt'>): Promise<PendingUpload>;
  get(id: string): Promise<PendingUpload | null>;
  /** Removes it; returns whether it was there — two completes racing, only one wins. */
  delete(id: string): Promise<boolean>;
  /** Uploads whose URL has expired without a complete — the retention run removes them and their objects. */
  findExpired(now: Date, limit: number): Promise<PendingUpload[]>;
}

export class MissingPendingUploadStoreError extends Error {
  constructor() {
    super('No PendingUploadStore is bound. Direct uploads need one — bind it via FileStorageModule.forRoot({ pendingUploadStoreToken }).');
    this.name = 'MissingPendingUploadStoreError';
  }
}

/** The default — direct uploads throw until the consumer binds a store; `findExpired` finds nothing, so retention runs without one. */
export class MissingPendingUploadStore implements PendingUploadStore {
  async create(): Promise<never> {
    throw new MissingPendingUploadStoreError();
  }
  async get(): Promise<never> {
    throw new MissingPendingUploadStoreError();
  }
  async delete(): Promise<never> {
    throw new MissingPendingUploadStoreError();
  }
  async findExpired(): Promise<PendingUpload[]> {
    return [];
  }
}

/** The configured `FileStore` can't take a direct upload — upload through the API (`attach`) instead. */
export class DirectUploadUnsupportedError extends Error {
  constructor() {
    super('the configured FileStore does not take direct uploads (it does not implement DirectUploadFileStore) — use attach()');
    this.name = 'DirectUploadUnsupportedError';
  }
}
