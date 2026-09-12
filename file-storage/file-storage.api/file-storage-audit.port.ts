import { Injectable } from '@nestjs/common';

/**
 * Where `file-storage.api` sends an audit record after each destructive admin
 * operation — deleting a file, detaching an attachment, editing or
 * deactivating a category. Optional: bind `FILE_STORAGE_API_AUDIT_EMITTER`
 * (e.g. to an adapter over `audit-logging`) or leave the no-op. `file-storage.api`
 * takes **no** dependency on `audit-logging`.
 *
 * Note: file *uploads* are audited (if at all) through
 * `FileStorageModule.forRoot({ auditEmitterToken })` on the `.core` side, where
 * `AttachmentService.attach` runs — not here.
 */
export interface FileStorageApiAuditEvent {
  /** e.g. `'file.deleted'`, `'attachment.detached'`, `'file.category_override_set'`, `'file.category_deactivated'`. */
  action: string;
  actorId: string;
  tenantId: string | null;
  /** `'file'` | `'attachment'` | `'file_category'`. */
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface FileStorageApiAuditEmitter {
  record(event: FileStorageApiAuditEvent): Promise<void> | void;
}

@Injectable()
export class NoopFileStorageApiAuditEmitter implements FileStorageApiAuditEmitter {
  record(): void {
    /* no-op */
  }
}
