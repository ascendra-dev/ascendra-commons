import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import type { AttachmentStore } from './attachment-store.port';
import type { FileRecord } from './file-record.interface';
import type { FileRetentionStore, FileRetentionVolume } from './file-retention-store.port';
import type { FileStorageAuditEmitter } from './file-storage-audit.port';
import type { FileStorageOptions } from './file-storage.options';
import { isListableFileStore, type FileStore, type StoredObject } from './file-store.port';
import {
  ATTACHMENT_STORE,
  FILE_RETENTION_STORE,
  FILE_STORAGE_AUDIT_EMITTER,
  FILE_STORAGE_OPTIONS,
  FILE_STORE,
} from './tokens';

/** Who a retention run's audit events name. */
export const RETENTION_ACTOR: Actor = { id: 'system:file-retention', persona: 'system', tenantId: null };

const DEFAULT_BATCH = 500;
/** An object younger than this may be an upload whose record isn't written yet — never called stray. */
const DEFAULT_STRAY_GRACE_MS = 60 * 60 * 1000;

/** The configured `FileStore` can't list a bucket — `.api` answers 501. */
export class StrayBlobListingUnsupportedError extends Error {
  constructor() {
    super('the configured FileStore cannot list its objects (it does not implement ListableFileStore)');
    this.name = 'StrayBlobListingUnsupportedError';
  }
}

/** The object has a FileRecord after all — not a stray. */
export class NotAStrayBlobError extends Error {
  constructor(fileRef: string) {
    super(`'${fileRef}' belongs to a file record — delete the file, not the blob`);
    this.name = 'NotAStrayBlobError';
  }
}
const DEFAULT_LOG_BATCH = 5_000;
const DAY_MS = 86_400_000;

export interface FileRetentionRunResult {
  filesDeleted: number;
  bytesFreed: number;
  /** Files whose record went but whose blob delete failed — they show up as stray blobs. */
  blobDeleteFailures: number;
  accessLogRowsDeleted: number;
  rejectionRowsDeleted: number;
}

/**
 * Enforces what the catalog declares. Never runs on its own — call `run()`
 * from the project's scheduler (a `background-jobs` `ScheduledJob`, a cron).
 *
 *   - files past their `retainUntil` (fixed at upload) are deleted — record,
 *     attachments, blob — unless held; each is audited `file.deleted`, cause `retention`;
 *   - access-log rows older than `logRetention.accessLogDays` and rejection
 *     rows older than `logRetention.rejectionLogDays` are deleted.
 *
 * `purgeOrphans` is the console's cleanup of files with no attachment.
 *
 * Every delete re-checks its reason in the same statement it deletes in — a
 * hold placed, or an attachment linked, after the file was found keeps it.
 */
@Injectable()
export class FileRetentionService {
  private readonly logger = new Logger(FileRetentionService.name);

  constructor(
    @Inject(FILE_RETENTION_STORE) private readonly retention: FileRetentionStore,
    @Inject(ATTACHMENT_STORE) private readonly store: AttachmentStore,
    @Inject(FILE_STORE) private readonly fileStore: FileStore,
    @Inject(FILE_STORAGE_AUDIT_EMITTER) private readonly audit: FileStorageAuditEmitter,
    @Inject(FILE_STORAGE_OPTIONS) private readonly options: FileStorageOptions,
  ) {}

  /** One retention pass. `maxFiles` bounds the file deletes per run (default 5,000); the logs are pruned in full. */
  async run(opts: { now?: Date; maxFiles?: number } = {}): Promise<FileRetentionRunResult> {
    const now = opts.now ?? new Date();
    const maxFiles = Math.max(1, opts.maxFiles ?? 5_000);
    const result: FileRetentionRunResult = {
      filesDeleted: 0,
      bytesFreed: 0,
      blobDeleteFailures: 0,
      accessLogRowsDeleted: 0,
      rejectionRowsDeleted: 0,
    };

    while (result.filesDeleted < maxFiles) {
      const batch = await this.retention.findExpiredFiles(now, Math.min(DEFAULT_BATCH, maxFiles - result.filesDeleted));
      if (batch.length === 0) break;
      let progressed = false;
      for (const record of batch) {
        const removed = await this.store.deleteFileCascade(record.id, { onlyIf: { expiredBy: now } });
        if (!removed) continue; // held or re-dated since it was found
        progressed = true;
        await this.finishDelete(removed, RETENTION_ACTOR, 'retention', result);
      }
      if (!progressed) break; // everything left in the batch is held — the next find would return it again
    }

    const { accessLogDays, rejectionLogDays } = this.options.logRetention;
    result.accessLogRowsDeleted = await this.retention.pruneAccessLog(new Date(now.getTime() - accessLogDays * DAY_MS), DEFAULT_LOG_BATCH);
    result.rejectionRowsDeleted = await this.retention.pruneRejections(new Date(now.getTime() - rejectionLogDays * DAY_MS), DEFAULT_LOG_BATCH);
    this.logger.log(
      `retention: ${result.filesDeleted} files (${result.bytesFreed} bytes), ` +
        `${result.accessLogRowsDeleted} access rows, ${result.rejectionRowsDeleted} rejection rows`,
    );
    return result;
  }

  /**
   * Deletes files with no attachment created before `olderThan` — skipping
   * held files and files inside their retention period. `tenantId` scopes it
   * (the `.api` forces a tenant actor's own). Audited per file, cause `orphan-purge`.
   */
  async purgeOrphans(input: { actor: Actor; olderThan: Date; tenantId?: string; limit?: number }): Promise<{ deleted: number; bytesFreed: number }> {
    const now = new Date();
    const found = await this.retention.findPurgeableOrphans({
      olderThan: input.olderThan,
      now,
      tenantId: input.tenantId,
      limit: Math.min(Math.max(1, input.limit ?? 1_000), 1_000),
    });
    const result: FileRetentionRunResult = { filesDeleted: 0, bytesFreed: 0, blobDeleteFailures: 0, accessLogRowsDeleted: 0, rejectionRowsDeleted: 0 };
    for (const record of found) {
      const early = record.retainUntil !== null && record.retainUntil > now;
      if (early) continue;
      const removed = await this.store.deleteFileCascade(record.id, { onlyIf: { orphaned: true } });
      if (removed) await this.finishDelete(removed, input.actor, 'orphan-purge', result);
    }
    return { deleted: result.filesDeleted, bytesFreed: result.bytesFreed };
  }

  /**
   * Objects in `bucket` with no `FileRecord` — a blob left by a failed
   * rollback or a failed blob delete. One page of the store's listing per
   * call: `data` may be shorter than the page (most objects have records) and
   * `nextCursor` continues the walk. Objects younger than `graceMs` (1 hour)
   * are left out — an upload writes its blob before its record.
   */
  async findStrayBlobs(input: { bucket: string; cursor?: string; limit?: number; graceMs?: number }): Promise<{ data: StoredObject[]; nextCursor: string | null }> {
    if (!isListableFileStore(this.fileStore)) throw new StrayBlobListingUnsupportedError();
    const page = await this.fileStore.listObjects(input.bucket, { cursor: input.cursor, limit: Math.min(Math.max(1, input.limit ?? 200), 1_000) });
    const cutoff = Date.now() - (input.graceMs ?? DEFAULT_STRAY_GRACE_MS);
    const old = page.objects.filter((o) => o.modifiedAt.getTime() < cutoff);
    const recorded = old.length ? await this.retention.findRecordedRefs(old.map((o) => o.fileRef)) : new Set<string>();
    return { data: old.filter((o) => !recorded.has(o.fileRef)), nextCursor: page.nextCursor };
  }

  /** Deletes one stray blob — after re-checking no record holds it. Audited `file.stray_blob_deleted`. */
  async deleteStrayBlob(input: { fileRef: string; sizeBytes?: number; actor: Actor }): Promise<void> {
    if ((await this.retention.findRecordedRefs([input.fileRef])).has(input.fileRef)) throw new NotAStrayBlobError(input.fileRef);
    await this.fileStore.delete(input.fileRef);
    try {
      await this.audit.emit({ kind: 'file.stray_blob_deleted', fileRef: input.fileRef, sizeBytes: input.sizeBytes ?? 0, actor: input.actor });
    } catch {
      /* best-effort */
    }
  }

  /** `tenantId` set → that tenant's rows only (the `.api` forces a tenant actor's own). */
  async volume(tenantId?: string, now = new Date()): Promise<FileRetentionVolume & { policy: FileStorageOptions['logRetention'] }> {
    return { ...(await this.retention.volume(now, tenantId)), policy: this.options.logRetention };
  }

  private async finishDelete(
    removed: FileRecord,
    actor: Actor,
    cause: 'retention' | 'orphan-purge',
    result: FileRetentionRunResult,
  ): Promise<void> {
    result.filesDeleted += 1;
    result.bytesFreed += removed.sizeBytes;
    try {
      await this.fileStore.delete(removed.fileRef);
    } catch {
      result.blobDeleteFailures += 1; // the stray-blob check finds it
    }
    try {
      await this.audit.emit({
        kind: 'file.deleted',
        fileRecordId: removed.id,
        tenantId: removed.tenantId,
        actor,
        before: removed,
        overrodeRetention: false,
        cause,
      });
    } catch {
      /* best-effort */
    }
  }
}
