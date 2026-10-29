import type { Actor } from '../../authorization/authorization.core';
import type { FileRecord, LegalHold } from './file-record.interface';

/**
 * Best-effort audit hook for the mutating `AttachmentService` operations —
 * attach, link, detach, delete. Optional: bind a real emitter via
 * `FileStorageModule.forRoot({ auditEmitterToken })` to forward these as
 * `AuditRecordRaised`-shaped events; the default is a no-op.
 *
 * `AttachmentService` never fails an operation because the emitter threw.
 */
export type FileStorageAuditEvent =
  | { kind: 'file.attached'; fileRecordId: string; attachmentId: string; tenantId: string; category: string; actor: Actor }
  | { kind: 'file.linked'; fileRecordId: string; attachmentId: string; tenantId: string; category: string; actor: Actor }
  | { kind: 'file.detached'; attachmentId: string; fileRecordId: string; tenantId: string; actor: Actor }
  | {
      kind: 'file.deleted';
      fileRecordId: string;
      tenantId: string;
      actor: Actor;
      /** The record as it was — what an auditor needs once the row is gone. */
      before: FileRecord;
      /** A platform admin deleted it before its `retainUntil`. */
      overrodeRetention: boolean;
      /** Who asked: a person (`request`), the retention run, or an orphan purge. */
      cause: 'request' | 'retention' | 'orphan-purge';
    }
  | { kind: 'file.hold_placed'; fileRecordId: string; tenantId: string; actor: Actor; reason: string }
  | { kind: 'file.hold_released'; fileRecordId: string; tenantId: string; actor: Actor; before: LegalHold };

export interface FileStorageAuditEmitter {
  emit(event: FileStorageAuditEvent): Promise<void>;
}

export class NoopFileStorageAuditEmitter implements FileStorageAuditEmitter {
  async emit(): Promise<void> {}
}
