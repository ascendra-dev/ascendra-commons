import { Injectable } from '@nestjs/common';

/**
 * Where `file-storage.api` sends an audit record for what only it does — a
 * content view and catalog changes. Deletes, detaches and legal holds are
 * audited once, by `AttachmentService`'s `.core` emitter. Optional: bind `FILE_STORAGE_API_AUDIT_EMITTER`
 * (e.g. to an adapter over `audit-logging`) or leave the no-op. `file-storage.api`
 * takes **no** dependency on `audit-logging`.
 *
 * Note: file *uploads* are audited (if at all) through
 * `FileStorageModule.forRoot({ auditEmitterToken })` on the `.core` side, where
 * `AttachmentService.attach` runs — not here.
 */
export interface FileStorageApiAuditEvent {
  /** `'file.content_viewed'`, `'file.category_override_set'`, `'file.category_deactivated'`, `'file.category_activated'`. */
  action: string;
  actorId: string;
  /** The tenant the action touched — the file's, or the override's; `null` for a base category. */
  tenantId: string | null;
  /** `'file'` | `'file_category'`. */
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
